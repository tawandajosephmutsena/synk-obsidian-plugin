import { App, Notice, TFile } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { LocalFileState, SyncStateData, SynkkSettings } from './types';

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

  private shouldIgnore(path: string): boolean {
    if (path.startsWith('.obsidian') || path.startsWith('.git') || path.startsWith('.trash')) {
      return true;
    }
    if (path.endsWith('.DS_Store') || path.includes('/.DS_Store')) {
      return true;
    }
    return false;
  }

  public async computeSha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  public getIsSyncing(): boolean {
    return this.isSyncing;
  }

  public async sync(): Promise<{ pulled: number; pushed: number; conflicts: number; errors: number }> {
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

      // STEP 2: Handle remote deletions
      for (const del of manifest.deleted) {
        if (this.shouldIgnore(del.path)) continue;

        if (await this.app.vault.adapter.exists(del.path)) {
          await this.app.vault.adapter.remove(del.path);
          delete this.stateData.files[del.path];
          pulled++;
        }
      }

      // STEP 3: Handle remote additions and modifications (pull)
      for (const remoteFile of manifest.files) {
        if (this.shouldIgnore(remoteFile.path)) continue;

        let needsDownload = false;
        const exists = await this.app.vault.adapter.exists(remoteFile.path);

        if (!exists) {
          needsDownload = true;
        } else {
          const localBuffer = await this.app.vault.adapter.readBinary(remoteFile.path);
          const localSha = await this.computeSha256(localBuffer);

          if (localSha !== remoteFile.sha256) {
            // Hash differs! Download remote version
            needsDownload = true;
          }
        }

        if (needsDownload) {
          try {
            this.onStatusChange?.(`Pulling ${remoteFile.path}...`, true);
            const buffer = await this.api.downloadFile(vaultSlug, remoteFile.path);

            // Ensure directory exists
            const lastSlash = remoteFile.path.lastIndexOf('/');
            if (lastSlash !== -1) {
              const dir = remoteFile.path.substring(0, lastSlash);
              if (!(await this.app.vault.adapter.exists(dir))) {
                await this.app.vault.adapter.mkdir(dir);
              }
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
        if (this.shouldIgnore(path)) continue;

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
        if (this.shouldIgnore(knownPath)) continue;

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
      this.stateData.lastSyncVersion = manifest.vault.latest_version || 0;
      await this.saveState();

      await this.saveSettings({
        lastSyncTime: Date.now(),
        lastSyncVersion: this.stateData.lastSyncVersion,
      });

      const summary = `Synkk: Complete (↓${pulled} ↑${pushed}${conflicts > 0 ? ` ⚠️${conflicts} conflicts` : ''})`;
      this.onStatusChange?.(summary, false);
      new Notice(summary);
    } catch (err: any) {
      console.error('Synkk sync error:', err);
      this.onStatusChange?.('Sync error: ' + (err.message || 'Unknown'), false);
      new Notice(`Synkk sync error: ${err.message || 'Unknown'}`);
      errors++;
    } finally {
      this.isSyncing = false;
    }

    return { pulled, pushed, conflicts, errors };
  }
}
