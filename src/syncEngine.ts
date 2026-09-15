import { App, Notice, Platform, TFile } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { E2eeVaultEngine } from './e2ee';
import { chunkFilesForBatchUpload, deletionGuard, shouldSyncPath } from './sync-policy';
import { createFileState, getIsolatedStatePath, isFileModifiedLocally, reconcileRemotePull } from './sync-state';
import { SyncStateData, SynkkSettings } from './types';

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
  private syncPromise: Promise<SyncResult> | null = null;
  private syncQueue: Array<(result: SyncResult) => void> = [];
  private onStatusChange?: (status: string, isSyncing: boolean) => void;
  public e2eeEngine: E2eeVaultEngine = new E2eeVaultEngine();

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

  public getStatePath(): string {
    const settings = this.getSettings();
    return getIsolatedStatePath(settings.serverUrl, settings.selectedVaultSlug);
  }

  public async loadState(): Promise<void> {
    try {
      const statePath = this.getStatePath();
      if (await this.app.vault.adapter.exists(statePath)) {
        const raw = await this.app.vault.adapter.read(statePath);
        this.stateData = JSON.parse(raw);
        for (const f of Object.values(this.stateData.files || {})) {
          if (!f.localPlaintextSha256 && f.sha256) {
            f.localPlaintextSha256 = f.sha256;
          }
          if (!f.remotePayloadSha256 && f.sha256) {
            f.remotePayloadSha256 = f.sha256;
          }
        }
        return;
      }

      // Fallback migration from legacy non-isolated state file
      const configDir = (this.app.vault as any).configDir || '.obsidian';
      const legacyPath = `${configDir}/synkk-state.json`;
      if (await this.app.vault.adapter.exists(legacyPath)) {
        const raw = await this.app.vault.adapter.read(legacyPath);
        this.stateData = JSON.parse(raw);
        for (const f of Object.values(this.stateData.files || {})) {
          if (!f.localPlaintextSha256 && f.sha256) {
            f.localPlaintextSha256 = f.sha256;
          }
          if (!f.remotePayloadSha256 && f.sha256) {
            f.remotePayloadSha256 = f.sha256;
          }
        }
        await this.saveState();
      }
    } catch {
      this.stateData = { lastSyncVersion: 0, files: {} };
    }
  }

  public async saveState(): Promise<void> {
    try {
      const statePath = this.getStatePath();
      await this.app.vault.adapter.write(statePath, JSON.stringify(this.stateData, null, 2));
    } catch (e) {
      console.error('Failed to save Synkk state file:', e);
    }
  }

  public shouldSync(path: string): boolean {
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
    if (this.syncPromise) {
      return new Promise<SyncResult>((resolve) => {
        this.syncQueue.push(resolve);
      });
    }

    this.syncPromise = this.executeSync();
    try {
      const result = await this.syncPromise;
      return result;
    } finally {
      this.syncPromise = null;
      if (this.syncQueue.length > 0) {
        const queuedResolvers = [...this.syncQueue];
        this.syncQueue = [];
        void this.sync()
          .then((nextResult) => {
            for (const resolve of queuedResolvers) {
              resolve(nextResult);
            }
          })
          .catch((err) => {
            console.error('Queued sync error:', err);
          });
      }
    }
  }

  private async executeSync(): Promise<SyncResult> {
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

      // Initialize Zero-Knowledge E2EE if active
      if (manifest.vault?.is_e2ee && manifest.vault?.e2ee_salt) {
        if (!settings.e2eePassphrase) {
          new Notice('Synkk: Vault has Zero-Knowledge E2EE enabled. Please enter your vault passphrase in Settings.', 8000);
        } else {
          await this.e2eeEngine.initialize(settings.e2eePassphrase, manifest.vault.e2ee_salt);
        }
      } else if (settings.e2eeEnabled && settings.e2eePassphrase && settings.e2eeSalt) {
        await this.e2eeEngine.initialize(settings.e2eePassphrase, settings.e2eeSalt);
      }

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
          const known = this.stateData.files[remoteFile.path];

          const decision = reconcileRemotePull(remoteFile, localSha, known);
          needsDownload = decision.needsDownload;
          isConflict = decision.isConflict;
          if (isConflict) {
            localConflictBuffer = localBuffer;
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
            const isAttachment = !remoteFile.path.endsWith('.md');
            const shouldGhost = settings.ghostFilesEnabled && Platform.isMobile && isAttachment && (remoteFile.size > settings.ghostThresholdMb * 1024 * 1024);
            const asGhost = shouldGhost || Boolean(remoteFile.is_ghost);

            let buffer = await this.api.downloadFile(vaultSlug, remoteFile.path, asGhost);

            // Zero-Knowledge E2EE Decryption
            if (remoteFile.is_encrypted && !asGhost) {
              if (!this.e2eeEngine.isReady()) {
                new Notice(`Synkk: "${remoteFile.path}" is encrypted with Zero-Knowledge E2EE, but key is not initialized.`);
                errors++;
                continue;
              }
              try {
                const decryptedBytes = await this.e2eeEngine.decrypt(
                  buffer,
                  remoteFile.encryption_iv!,
                  remoteFile.encryption_tag
                );
                buffer = decryptedBytes.buffer.slice(
                  decryptedBytes.byteOffset,
                  decryptedBytes.byteOffset + decryptedBytes.byteLength
                ) as ArrayBuffer;
              } catch (decErr: any) {
                console.error(`E2EE decryption error on ${remoteFile.path}:`, decErr);
                new Notice(`Synkk: Could not decrypt "${remoteFile.path}". Check passphrase in Settings.`);
                errors++;
                continue;
              }
            }

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

            const localPlaintextSha = await this.computeSha256(buffer);
            this.stateData.files[remoteFile.path] = createFileState({
              localPlaintextSha,
              remotePayloadSha: remoteFile.sha256,
              version: remoteFile.version,
              mtime: Date.now(),
              isEncrypted: Boolean(remoteFile.is_encrypted),
            });

            pulled++;
          } catch (err: any) {
            console.error(`Error downloading ${remoteFile.path}:`, err);
            errors++;
          }
        } else {
          if (!this.stateData.files[remoteFile.path]) {
            const localBuffer = await this.app.vault.adapter.readBinary(remoteFile.path);
            const localPlaintextSha = await this.computeSha256(localBuffer);
            this.stateData.files[remoteFile.path] = createFileState({
              localPlaintextSha,
              remotePayloadSha: remoteFile.sha256,
              version: remoteFile.version,
              mtime: Date.now(),
              isEncrypted: Boolean(remoteFile.is_encrypted),
            });
          }
        }
      }

      // STEP 4: Scan local files and batch push modifications
      this.onStatusChange?.('Scanning local changes...', true);
      const allFiles = this.app.vault.getFiles();
      const filesToPush: Array<{
        file: TFile;
        path: string;
        buffer: ArrayBuffer;
        localSha: string;
        knownVersion: number;
      }> = [];

      for (const file of allFiles) {
        const path = file.path;
        if (!this.shouldSync(path)) continue;

        try {
          const buffer = await this.app.vault.adapter.readBinary(path);
          const sha256 = await this.computeSha256(buffer);
          const known = this.stateData.files[path];

          // If file is new or modified locally
          if (isFileModifiedLocally(sha256, known)) {
            filesToPush.push({
              file,
              path,
              buffer,
              localSha: sha256,
              knownVersion: known ? known.version : 0,
            });
          }
        } catch (err: any) {
          console.error(`Error inspecting ${path}:`, err);
          errors++;
        }
      }

      // Process modified files in dynamic batches constrained by count and payload size
      const fileChunks = chunkFilesForBatchUpload(filesToPush, 50, 8 * 1024 * 1024);
      let pushedSoFar = 0;
      for (const chunk of fileChunks) {
        const batchProgress = fileChunks.length > 1
          ? ` (${pushedSoFar + 1}-${pushedSoFar + chunk.length} of ${filesToPush.length})`
          : '';
        this.onStatusChange?.(`Pushing changes${batchProgress}...`, true);

        const batchPayload = [];
        for (const item of chunk) {
          let uploadBuffer: ArrayBuffer = item.buffer;
          let uploadExtra: any = {};

          const isVaultE2ee = Boolean(manifest.vault?.is_e2ee || settings.e2eeEnabled);

          if (isVaultE2ee) {
            if (!this.e2eeEngine.isReady() && settings.e2eePassphrase && manifest.vault?.e2ee_salt) {
              await this.e2eeEngine.initialize(settings.e2eePassphrase, manifest.vault.e2ee_salt);
            }

            if (!this.e2eeEngine.isReady()) {
              new Notice('Synkk: Vault has Zero-Knowledge E2EE enabled on server. Please enter your passphrase in Settings.', 9000);
              errors++;
              continue;
            }

            const enc = await this.e2eeEngine.encrypt(item.buffer);
            uploadBuffer = enc.ciphertext.buffer.slice(
              enc.ciphertext.byteOffset,
              enc.ciphertext.byteOffset + enc.ciphertext.byteLength
            ) as ArrayBuffer;
            uploadExtra = {
              is_encrypted: true,
              encryption_iv: enc.ivHex,
              encryption_tag: enc.tagHex,
              encrypted: true,
              iv: enc.ivHex,
              tag: enc.tagHex,
              format_version: 2,
            };
          }

          const base64 = this.arrayBufferToBase64(uploadBuffer);
          batchPayload.push({
            action: 'upload' as const,
            path: item.path,
            content_base64: base64,
            base_version: item.knownVersion,
            ...uploadExtra,
          });
        }

        try {
          const res = await this.api.batchSync(vaultSlug, batchPayload);
          const resultMap = new Map<string, any>();
          if (Array.isArray(res.items)) {
            for (const r of res.items) {
              resultMap.set(r.path, r);
            }
          }

          for (const item of chunk) {
            const r = resultMap.get(item.path);
            if (!r || r.status === 'error' || r.status === 'forbidden') {
              errors++;
              console.error(`Error uploading ${item.path}:`, r?.message || 'Unknown batch error');
              new Notice(`Synkk: ${r?.message || 'Upload failed for ' + item.path}`);
              continue;
            }

            if (r.has_secrets && r.detected_secrets && r.detected_secrets.length > 0) {
              const detected = r.detected_secrets.join(', ');
              new Notice(`⚠️ Synkk DLP Guard: Potential secret pattern detected in "${item.path}" (${detected}). Team audit logged.`, 9000);
            }

            if (r.status === 'conflict') {
              conflicts++;
              new Notice(`Synkk: Conflict on "${item.path}". Saved version as "${r.path}".`, 6000);
            } else if (r.status === 'identical') {
              // Up to date
            } else {
              pushed++;
            }

            const isEncrypted = Boolean(settings.e2eeEnabled && this.e2eeEngine.isReady());
            this.stateData.files[item.path] = createFileState({
              localPlaintextSha: item.localSha,
              remotePayloadSha: r.sha256 || item.localSha,
              version: r.version || item.knownVersion,
              mtime: item.file.stat.mtime,
              isEncrypted,
            });
          }
        } catch (err: any) {
          console.error(`Error in batch upload:`, err);
          errors += chunk.length;
          new Notice(`Synkk: Batch upload failed: ${err.message || 'Unknown error'}`);
        }

        pushedSoFar += chunk.length;
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
