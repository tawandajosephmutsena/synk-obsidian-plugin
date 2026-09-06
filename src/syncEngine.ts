import { App, Notice, Platform } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { deletionGuard, shouldSyncPath } from './sync-policy';
import { LocalFileState, SyncStateData, SynkkSettings } from './types';

interface SyncResult {
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: number;
}

export class SynkkSyncEngine {
  private app: App;
  private api: SynkkApiClient;
  private getSettings: () => SynkkSettings;
  private saveSettings: (settings: Partial<SynkkSettings>) => Promise<void>;
  private isSyncing: boolean = false;
  private onStatusChange?: (status: string, isSyncing: boolean) => void;

  private stateData: SyncStateData = {
    lastSyncVersion: 0,
    files: {},
  };

  constructor(
    app: App,
    api: SynkkApiClient,
    getSettings: () => SynkkSettings,
    saveSettings: (settings: Partial<SynkkSettings>) => Promise<void>,
    onStatusChange?: (status: string, isSyncing: boolean) => void
  ) {
    this.app = app;
    this.api = api;
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.onStatusChange = onStatusChange;
  }

  public async loadState(): Promise<void> {
    try {
      const statePath = '.obsidian/synkk-state.json';
      if (await this.app.vault.adapter.exists(statePath)) {
        const raw = await this.app.vault.adapter.read(statePath);
        this.stateData = JSON.parse(raw);
      }
    } catch {
      this.stateData = { lastSyncVersion: 0, files: {} };
    }
  }

  public async saveState(): Promise<void> {
    try {
      const statePath = '.obsidian/synkk-state.json';
      await this.app.vault.adapter.write(statePath, JSON.stringify(this.stateData, null, 2));
    } catch (e) {
      console.error('Failed to save Synkk state file:', e);
    }
  }

  private shouldSync(path: string): boolean {
    return shouldSyncPath(path, {
      ...this.getSettings(),
      isMobile: Platform.isMobile,
    });
  }

  private selectedTrackedPaths(): string[] {
    return Object.keys(this.stateData.files).filter((path) => this.shouldSync(path));
  }

  private async localDeletionPaths(): Promise<string[]> {
    const deletedPaths: string[] = [];

    for (const path of this.selectedTrackedPaths()) {
      if (!await this.app.vault.adapter.exists(path)) {
        deletedPaths.push(path);
      }
    }

    return deletedPaths;
  }

  private safetyHalt(
    direction: 'incoming' | 'outgoing',
    paths: string[],
    baselineCount: number,
    percentage: number,
    thresholdPercent: number,
  ): SyncResult {
    const sample = paths.slice(0, 3).join(', ');
    const summary = `Synkk: Safety Shield stopped ${direction} deletion of ${paths.length}/${baselineCount} files (${percentage}%, limit ${thresholdPercent}%).`;

    this.onStatusChange?.('Safety Shield requires confirmation.', false);
    new Notice(`${summary} Review settings to allow one guarded sync. ${sample}`, 10000);

    return { pulled: 0, pushed: 0, conflicts: 0, errors: 1 };
  }

  private async ensureDirectory(path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(currentPath)) {
        await this.app.vault.adapter.mkdir(currentPath);
      }
    }
  }

  private async snapshotLocalFile(path: string): Promise<void> {
    const contents = await this.app.vault.adapter.readBinary(path);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `.synkk/snapshots/${timestamp}/${path}`;
    const directory = snapshotPath.substring(0, snapshotPath.lastIndexOf('/'));

    await this.ensureDirectory(directory);
    await this.app.vault.adapter.writeBinary(snapshotPath, contents);
  }

  public async computeSha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buffer).toString('base64');
    }

    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return window.btoa(binary);
  }

  public getIsSyncing(): boolean {
    return this.isSyncing;
  }

  public async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      new Notice('Synkk: A synchronization is already in progress.');
      return { pulled: 0, pushed: 0, conflicts: 0, errors: 0 };
    }

    const settings = this.getSettings();
    if (!settings.deviceToken || !settings.selectedVaultSlug) {
      new Notice('Synkk: Please configure your Device Token and select a Vault in settings.');
      return { pulled: 0, pushed: 0, conflicts: 0, errors: 0 };
    }

    this.isSyncing = true;
    this.onStatusChange?.('Syncing...', true);

    let pulled = 0;
    let pushed = 0;
    let conflicts = 0;
    let errors = 0;

    try {
      await this.loadState();
      const vaultSlug = settings.selectedVaultSlug;

      // STEP 1: Fetch remote manifest
      this.onStatusChange?.('Checking remote changes...', true);
      const manifest = await this.api.getManifest(vaultSlug, this.stateData.lastSyncVersion);
      const baselineCount = this.selectedTrackedPaths().length;
      const remoteDeletionPaths: string[] = [];

      for (const deletedFile of manifest.deleted) {
        if (this.shouldSync(deletedFile.path) && await this.app.vault.adapter.exists(deletedFile.path)) {
          remoteDeletionPaths.push(deletedFile.path);
        }
      }

      const localDeletionPaths = await this.localDeletionPaths();
      const remoteDeletionGuard = deletionGuard(
        remoteDeletionPaths,
        baselineCount,
        settings.deletionThresholdPercent,
        settings.safetyOverrideForNextSync,
      );
      const localDeletionGuard = deletionGuard(
        localDeletionPaths,
        baselineCount,
        settings.deletionThresholdPercent,
        settings.safetyOverrideForNextSync,
      );

      if (remoteDeletionGuard.blocked) {
        return this.safetyHalt(
          'incoming',
          remoteDeletionPaths,
          baselineCount,
          remoteDeletionGuard.percentage,
          settings.deletionThresholdPercent,
        );
      }

      if (localDeletionGuard.blocked) {
        return this.safetyHalt(
          'outgoing',
          localDeletionPaths,
          baselineCount,
          localDeletionGuard.percentage,
          settings.deletionThresholdPercent,
        );
      }

      const safetyOverrideWasUsed = settings.safetyOverrideForNextSync
        && (remoteDeletionGuard.percentage > settings.deletionThresholdPercent
          || localDeletionGuard.percentage > settings.deletionThresholdPercent);

      // STEP 2: Handle remote deletions
      for (const del of manifest.deleted) {
        if (!this.shouldSync(del.path)) continue;

        if (await this.app.vault.adapter.exists(del.path)) {
          try {
            await this.snapshotLocalFile(del.path);
            await this.app.vault.adapter.remove(del.path);
            delete this.stateData.files[del.path];
            pulled++;
          } catch (err: any) {
            console.error(`Error applying remote deletion for ${del.path}:`, err);
            errors++;
            new Notice(`Synkk: Could not safely apply deletion for ${del.path}.`);
          }
        }
      }

      // STEP 3: Handle remote additions and modifications (pull)
      for (const remoteFile of manifest.files) {
        if (!this.shouldSync(remoteFile.path)) continue;

        let needsDownload = false;
        let isConflict = false;
        let localConflictBuffer: ArrayBuffer | null = null;
        const exists = await this.app.vault.adapter.exists(remoteFile.path);

        if (!exists) {
          needsDownload = true;
        } else {
          const localBuffer = await this.app.vault.adapter.readBinary(remoteFile.path);
          const localSha = await this.computeSha256(localBuffer);

          if (localSha !== remoteFile.sha256) {
            // Hash differs! Check if local was modified or newly created concurrently
            const lastKnown = this.stateData.files[remoteFile.path];
            if (!lastKnown || lastKnown.sha256 !== localSha) {
              // Local was changed or newly created: concurrent conflict!
              isConflict = true;
              localConflictBuffer = localBuffer;
            }
            needsDownload = true;
          }
        }

        if (needsDownload) {
          try {
            if (isConflict && localConflictBuffer) {
              // Fork local modifications to a conflict file so work is never lost
              const extMatch = remoteFile.path.match(/(\.[^.]+)$/);
              const conflictPath = extMatch
                ? remoteFile.path.replace(/(\.[^.]+)$/, `.sync-conflict-${Date.now()}$1`)
                : `${remoteFile.path}.sync-conflict-${Date.now()}`;

              await this.app.vault.adapter.writeBinary(conflictPath, localConflictBuffer);
              conflicts++;
              new Notice(`Synkk: Local modification conflict on "${remoteFile.path}". Forked local copy to "${conflictPath}".`, 8000);
            }

            this.onStatusChange?.(`Pulling ${remoteFile.path}...`, true);
            const buffer = await this.api.downloadFile(vaultSlug, remoteFile.path);

            if (exists) {
              await this.snapshotLocalFile(remoteFile.path);
            }

            // Ensure directory exists
            const lastSlash = remoteFile.path.lastIndexOf('/');
            if (lastSlash !== -1) {
              const dir = remoteFile.path.substring(0, lastSlash);
              await this.ensureDirectory(dir);
            }

            await this.app.vault.adapter.writeBinary(remoteFile.path, buffer);

            this.stateData.files[remoteFile.path] = {
              sha256: remoteFile.sha256,
              mtime: Date.now(),
              version: remoteFile.version,
            };

            pulled++;
          } catch (err: any) {
            console.error(`Error downloading ${remoteFile.path}:`, err);
            errors++;
          }
        } else {
          this.stateData.files[remoteFile.path] = {
            sha256: remoteFile.sha256,
            mtime: Date.now(),
            version: remoteFile.version,
          };
        }
      }

      // STEP 4: Scan local files and push modifications
      this.onStatusChange?.('Scanning local changes...', true);
      const allFiles = this.app.vault.getFiles();

      for (const file of allFiles) {
        const path = file.path;
        if (!this.shouldSync(path)) continue;

        try {
          const buffer = await this.app.vault.adapter.readBinary(path);
          const sha256 = await this.computeSha256(buffer);
          const known = this.stateData.files[path];

          // If file is new or modified locally
          if (!known || known.sha256 !== sha256) {
            this.onStatusChange?.(`Pushing ${path}...`, true);
            const base64 = this.arrayBufferToBase64(buffer);
            const baseVersion = known ? known.version : 0;

            const res = await this.api.uploadFile(vaultSlug, path, base64, baseVersion);

            if (res.has_secrets && res.detected_secrets && res.detected_secrets.length > 0) {
              const detected = res.detected_secrets.join(', ');
              new Notice(`⚠️ Synkk DLP Guard: Potential secret pattern detected in "${path}" (${detected}). Team audit logged.`, 9000);
            }

            if (res.status === 'conflict') {
              conflicts++;
              new Notice(`Synkk: Conflict on "${path}". Saved version as "${res.path}".`, 6000);
            } else if (res.status === 'identical') {
              // Up to date
            } else {
              pushed++;
            }

            this.stateData.files[path] = {
              sha256,
              mtime: file.stat.mtime,
              version: res.version,
            };
          }
        } catch (err: any) {
          console.error(`Error uploading ${path}:`, err);
          errors++;
          new Notice(`Synkk: ${err.message || 'Upload failed'}`);
        }
      }

      // STEP 5: Detect and propagate local deletions
      for (const knownPath of Object.keys(this.stateData.files)) {
        if (!this.shouldSync(knownPath)) continue;

        if (!(await this.app.vault.adapter.exists(knownPath))) {
          try {
            this.onStatusChange?.(`Deleting remote ${knownPath}...`, true);
            await this.api.deleteFile(vaultSlug, knownPath);
            delete this.stateData.files[knownPath];
            pushed++;
          } catch (err: any) {
            console.error(`Error deleting remote ${knownPath}:`, err);
            errors++;
          }
        }
      }

      // STEP 6: Finalize state
      if (errors === 0) {
        this.stateData.lastSyncVersion = manifest.vault.latest_version || 0;
      }
      await this.saveState();

      await this.saveSettings({
        lastSyncTime: Date.now(),
        lastSyncVersion: this.stateData.lastSyncVersion,
        ...(safetyOverrideWasUsed ? { safetyOverrideForNextSync: false } : {}),
      });

      const summary = `Synkk: Complete (↓${pulled} ↑${pushed}${conflicts > 0 ? ` ⚠️${conflicts} conflicts` : ''})`;
      this.onStatusChange?.(summary, false);
      new Notice(summary);
    } catch (err: any) {
      console.error('Synkk sync error:', err);

      if (err.isRemoteWipe || err.status === 410 || (err.message && (err.message.includes('remote_wipe') || err.message.includes('Device Wiped') || err.message.includes('410')))) {
        this.stateData = { lastSyncVersion: 0, files: {} };
        await this.saveState();
        await this.saveSettings({ deviceToken: '' });
        new Notice('🚨 Synkk Security: This device was remotely wiped by an enterprise administrator. Local sync credentials have been purged.', 12000);
        this.onStatusChange?.('Device Remotely Wiped', false);
      } else {
        this.onStatusChange?.('Sync error: ' + (err.message || 'Unknown'), false);
        new Notice(`Synkk sync error: ${err.message || 'Unknown'}`);
      }

      errors++;
    } finally {
      this.isSyncing = false;
    }

    return { pulled, pushed, conflicts, errors };
  }
}
