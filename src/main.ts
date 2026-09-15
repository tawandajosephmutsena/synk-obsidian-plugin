import { addIcon, Notice, Plugin, TFile } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { BackgroundSyncRelay } from './backgroundRelay';
import { createCollabExtension } from './collabExtension';
import { CollabRelayClient } from './collabRelay';
import { ConflictResolverModal } from './conflictResolver';
import { SynkkEchoManager } from './echoManager';
import { GhostFileManager } from './ghostFiles';
import { SYNKK_OCTOPUS_ICON } from './icons';
import { VaultCopilotModal } from './ragModal';
import { SynkkSettingTab } from './settings';
import { SynkkSyncEngine } from './syncEngine';
import { DEFAULT_SETTINGS, SynkkSettings } from './types';

export default class SynkkPlugin extends Plugin {
  declare settings: SynkkSettings;
  apiClient: SynkkApiClient;
  syncEngine: SynkkSyncEngine;
  collabRelay: CollabRelayClient;
  backgroundRelay: BackgroundSyncRelay;
  echoManager: SynkkEchoManager;
  private statusBarEl: HTMLElement;
  private syncIntervalId: number | null = null;
  private debouncedSyncTimeout: number | null = null;

  async onload() {
    addIcon('synkk-octopus', SYNKK_OCTOPUS_ICON);
    await this.loadSettings();

    // Initialize API Client & Sync Engine
    this.apiClient = new SynkkApiClient(this.settings.serverUrl, this.settings.deviceToken);
    this.syncEngine = new SynkkSyncEngine(
      this.app,
      this.apiClient,
      () => this.settings,
      async (patch) => {
        Object.assign(this.settings, patch);
        await this.saveData(this.settings);
      },
      (status, isSyncing) => this.updateStatusBar(status, isSyncing)
    );

    // Eagerly initialize E2EE key on startup if passphrase & salt are configured
    if (this.settings.e2eePassphrase && this.settings.e2eeSalt) {
      try {
        await this.syncEngine.e2eeEngine.initialize(this.settings.e2eePassphrase, this.settings.e2eeSalt);
      } catch (e) {
        console.error('Synkk: Failed to initialize E2EE engine on startup:', e);
      }
    }

    this.echoManager = new SynkkEchoManager(this);
    this.collabRelay = new CollabRelayClient(this);

    // Register CodeMirror 6 live collaboration presence & caret extension
    this.registerEditorExtension(createCollabExtension(this));

    // Initialize Native Mobile Background Relay
    this.backgroundRelay = new BackgroundSyncRelay(
      this.app,
      this.apiClient,
      () => this.settings.selectedVaultSlug,
      async () => {
        await this.syncEngine.sync();
      }
    );
    if (this.settings.mobileBackgroundRelay) {
      this.backgroundRelay.start(60);
    }

    // Register obsidian://synkk-pair protocol handler for genuine one-scan pairing
    this.registerObsidianProtocolHandler('synkk-pair', async (params) => {
      const { handlePairingProtocol } = await import('./pairing');
      await handlePairingProtocol(this, params);
    });

    // Check for cold-start deep link parameters if app was launched via protocol URI
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get('action') === 'synkk-pair' || searchParams.has('session')) {
          const paramsObj: Record<string, string> = {};
          searchParams.forEach((val, key) => { paramsObj[key] = val; });
          if (paramsObj.server && paramsObj.session) {
            const { handlePairingProtocol } = await import('./pairing');
            window.setTimeout(() => { void handlePairingProtocol(this, paramsObj); }, 500);
          }
        }
      }
    } catch (e) {
      console.debug('Synkk: Cold-start URL check skipped:', e);
    }

    // Status bar indicator
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('synkk-status-bar');
    this.updateStatusBar('Synkk: Ready', false);
    this.statusBarEl.onClickEvent(async () => {
      if (this.statusBarEl.textContent?.includes('Safety Shield')) {
        this.settings.safetyOverrideForNextSync = true;
        await this.saveData(this.settings);
        new Notice('⚡ Synkk: Safety Shield override enabled for this sync run.', 5000);
      }
      void this.syncEngine.sync();
    });

    // Left Ribbon Icon (Sync Now)
    this.addRibbonIcon('synkk-octopus', 'Synkk: Sync Now', async () => {
      await this.syncEngine.sync();
    });

    // Left Ribbon Icon (Conflict Sandbox)
    this.addRibbonIcon('split', 'Synkk: Visual Conflict Sandbox', () => {
      new ConflictResolverModal(this.app, this).open();
    });

    // Left Ribbon Icon (Vault Copilot)
    this.addRibbonIcon('sparkles', 'Synkk: Ask Vault Copilot (RAG)', () => {
      if (!this.settings.selectedVaultSlug) {
        new Notice('Synkk: Please select a target vault in settings first.');
        return;
      }
      new VaultCopilotModal(this.app, this.apiClient, this.settings.selectedVaultSlug).open();
    });

    // Command: Sync Now
    this.addCommand({
      id: 'sync-now',
      name: 'Synchronize Now',
      callback: async () => {
        await this.syncEngine.sync();
      },
    });

    // Command: Open Conflict Sandbox
    this.addCommand({
      id: 'open-conflict-sandbox',
      name: 'Visual Conflict Sandbox: Reconcile Notes',
      callback: () => {
        new ConflictResolverModal(this.app, this).open();
      },
    });

    // Command: Hydrate Active Ghost File
    this.addCommand({
      id: 'hydrate-active-file',
      name: 'Ghost Files: Hydrate active file on-demand',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            void GhostFileManager.hydrateFile(this.app, this.apiClient, this.settings.selectedVaultSlug, activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Command: Dehydrate Active File
    this.addCommand({
      id: 'dehydrate-active-file',
      name: 'Ghost Files: Dehydrate active file to ghost stub',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            void GhostFileManager.dehydrateFile(this.app, this.apiClient, this.settings.selectedVaultSlug, activeFile.path);
          }
          return true;
        }
        return false;
      },
    });

    // Realtime collaboration presence relay on note switch
    this.registerEvent(
      this.app.workspace.on('file-open', async (file) => {
        const vaultSlug = this.settings.selectedVaultSlug;
        if (!vaultSlug || !this.collabRelay) return;

        if (this.collabRelay.currentPath && this.collabRelay.currentPath !== file?.path) {
          await this.collabRelay.leave(vaultSlug, this.collabRelay.currentPath);
        }

        if (file && file.extension === 'md') {
          await this.collabRelay.join(vaultSlug, file.path);
        }
      })
    );

    // Auto-sync on local file change, creation, deletion, or rename
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.syncEngine.shouldSync(file.path)) {
          this.triggerDebouncedSync();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && this.syncEngine.shouldSync(file.path)) {
          this.triggerDebouncedSync();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && this.syncEngine.shouldSync(file.path)) {
          this.triggerDebouncedSync();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && (this.syncEngine.shouldSync(file.path) || this.syncEngine.shouldSync(oldPath))) {
          this.triggerDebouncedSync();
        }
      })
    );

    // Command: Check Transport Status
    this.addCommand({
      id: 'check-transport-status',
      name: 'Transport Relay: Check server transport status',
      callback: async () => {
        if (!this.settings.selectedVaultSlug) {
          new Notice('Synkk: Please select a vault in settings first.');
          return;
        }
        try {
          const status = await this.apiClient.getTransportStatus(this.settings.selectedVaultSlug);
          new Notice(`Synkk Transport: Healthy (v${status.latest_version}, ${status.active_collaborators} online, E2EE: ${status.is_e2ee ? 'Active' : 'Off'})`, 6000);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`Synkk Transport Error: ${msg}`);
        }
      },
    });

    // Command: Ask Vault Copilot (RAG)
    this.addCommand({
      id: 'ask-vault-copilot',
      name: 'Vault Copilot: Ask a question (RAG)',
      callback: () => {
        if (!this.settings.selectedVaultSlug) {
          new Notice('Synkk: Please select a target vault in settings first.');
          return;
        }
        new VaultCopilotModal(this.app, this.apiClient, this.settings.selectedVaultSlug).open();
      },
    });

    // Command: Re-index Vector Embeddings
    this.addCommand({
      id: 'reindex-vault-embeddings',
      name: 'Vault Copilot: Re-index vector embeddings',
      callback: async () => {
        if (!this.settings.selectedVaultSlug) {
          new Notice('Synkk: Please select a target vault in settings first.');
          return;
        }
        new Notice('Synkk: Re-indexing vault vector embeddings...');
        try {
          const res = await this.apiClient.ragIndex(this.settings.selectedVaultSlug, true);
          new Notice(`Synkk: Re-indexed ${res.files_indexed} notes (${res.chunks_count} chunks) in ${res.duration_ms}ms.`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`Synkk: Re-indexing failed: ${msg}`);
        }
      },
    });

    // Settings Tab
    this.addSettingTab(new SynkkSettingTab(this.app, this));

    // Schedule Auto-Sync
    this.configureAutoSync();

    // Sync on Startup if configured
    if (this.settings.syncOnStartup && this.settings.deviceToken && this.settings.selectedVaultSlug) {
      window.setTimeout(() => {
        void this.syncEngine.sync();
      }, 2000);
    }
  }

  onunload() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.debouncedSyncTimeout !== null) {
      window.clearTimeout(this.debouncedSyncTimeout);
      this.debouncedSyncTimeout = null;
    }
    if (this.backgroundRelay) {
      this.backgroundRelay.stop();
    }
    if (this.echoManager) {
      this.echoManager.disconnect();
    }
    if (this.collabRelay?.currentPath && this.settings.selectedVaultSlug) {
      void this.collabRelay.leave(this.settings.selectedVaultSlug, this.collabRelay.currentPath);
    }
  }

  public triggerDebouncedSync(delayMs: number = 2500) {
    if (!this.settings.syncOnFileChange) return;
    if (!this.settings.deviceToken || !this.settings.selectedVaultSlug) return;
    if (this.syncEngine.getIsSyncing()) return;

    if (this.debouncedSyncTimeout !== null) {
      window.clearTimeout(this.debouncedSyncTimeout);
    }
    this.debouncedSyncTimeout = window.setTimeout(async () => {
      this.debouncedSyncTimeout = null;
      if (!this.syncEngine.getIsSyncing()) {
        await this.syncEngine.sync();
      }
    }, delayMs);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SynkkSettings> | null);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  public configureAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    if (this.settings.autoSync && this.settings.syncIntervalMinutes > 0) {
      const ms = this.settings.syncIntervalMinutes * 60 * 1000;
      this.syncIntervalId = window.setInterval(() => {
        if (!this.syncEngine.getIsSyncing()) {
          void this.syncEngine.sync();
        }
      }, ms);
    }
  }

  public updateStatusBar(status: string, isSyncing: boolean) {
    if (!this.statusBarEl) return;

    this.statusBarEl.empty();

    if (isSyncing) {
      this.statusBarEl.removeClass('is-error');
      this.statusBarEl.addClass('is-syncing');
      this.statusBarEl.createSpan({ cls: 'synkk-sync-spin', text: '🔄' });
      this.statusBarEl.createSpan({ text: ` ${status}` });
    } else {
      this.statusBarEl.removeClass('is-syncing');
      if (status.toLowerCase().includes('error')) {
        this.statusBarEl.addClass('is-error');
      } else {
        this.statusBarEl.removeClass('is-error');
      }
      this.statusBarEl.setText(status);
    }
  }
}
