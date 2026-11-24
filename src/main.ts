import { addIcon, Notice, Plugin, TFile } from 'obsidian';
import { AiProposalsModal } from './aiProposalsModal';
import { SYNKK_AI_VIEW_TYPE, SynkkAiSidebarView } from './aiSidebarView';
import { SynkkApiClient } from './apiClient';
import { BackgroundSyncRelay } from './backgroundRelay';
import { createCollabExtension } from './collabExtension';
import { CollabRelayClient } from './collabRelay';
import { ConflictResolverModal } from './conflictResolver';
import { SynkkEchoManager } from './echoManager';
import { GhostFileManager } from './ghostFiles';
import { SYNKK_OCTOPUS_ICON } from './icons';
import { formatProposalsBadgeText } from './localAiCore.js';
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
  private proposalsBadgeEl: HTMLElement | null = null;
  private syncIntervalId: number | null = null;
  private debouncedSyncTimeout: number | null = null;
  private lastBadgeRefreshAt = 0;

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
        await this.saveSettings();
      },
      (status, isSyncing) => this.updateStatusBar(status, isSyncing),
      () => (this.settings.realtimeCollaboration ? this.collabRelay?.currentPath ?? null : null)
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

    // Register Dockable AI Sidebar View
    this.registerView(SYNKK_AI_VIEW_TYPE, (leaf) => new SynkkAiSidebarView(leaf, this));

    // Status bar indicator
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('synkk-status-bar');
    this.updateStatusBar('Synkk: Ready', false);
    this.statusBarEl.onClickEvent(async () => {
      if (this.statusBarEl.textContent?.includes('Safety Shield')) {
        this.settings.safetyOverrideForNextSync = true;
        await this.saveSettings();
        new Notice('⚡ Synkk: Safety Shield override enabled for this sync run.', 5000);
      }
      void this.syncEngine.sync();
    });

    // Status bar AI Pending Proposals Badge (server mode only)
    this.proposalsBadgeEl = this.addStatusBarItem();
    this.proposalsBadgeEl.addClass('synkk-proposals-badge', 'synkk-hidden');
    this.proposalsBadgeEl.setAttribute('title', 'Synkk AI: Review pending change proposals');
    this.proposalsBadgeEl.onClickEvent(() => {
      new AiProposalsModal(this.app, this).open();
    });

    // Left Ribbon Icon (Sync Now)
    this.addRibbonIcon('synkk-octopus', 'Synkk: Sync Now', async () => {
      await this.syncEngine.sync();
    });

    // Left Ribbon Icon (Conflict Sandbox)
    this.addRibbonIcon('split', 'Synkk: Visual Conflict Sandbox', () => {
      new ConflictResolverModal(this.app, this).open();
    });

    // Left Ribbon Icon (Synkk AI Sidebar)
    this.addRibbonIcon('sparkles', 'Synkk AI: Open Copilot Sidebar', () => {
      void this.activateAiSidebar();
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

        if (this.settings.realtimeCollaboration && file && file.extension === 'md') {
          await this.collabRelay.join(vaultSlug, file.path);
        }
      })
    );

    // Auto-sync on local file change, creation, deletion, or rename
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.syncEngine.shouldSync(file.path)) {
          // Skip sync when the write originated from the collab relay's
          // snapshot flush — that content is already handled by the Yjs
          // transport and re-pushing it causes text duplication.
          if (this.collabRelay?.isFlushing) return;
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

    // Command: Open Dockable AI Sidebar
    this.addCommand({
      id: 'open-ai-sidebar',
      name: 'Synkk AI: Open Copilot Sidebar',
      callback: () => {
        void this.activateAiSidebar();
      },
    });

    // Command: Open AI Change Proposals Inbox
    this.addCommand({
      id: 'open-ai-proposals',
      name: 'Synkk AI: Open Change Inbox (Proposals)',
      callback: () => {
        new AiProposalsModal(this.app, this).open();
      },
    });

    // Command: Run Vault Gardener
    this.addCommand({
      id: 'run-vault-gardener',
      name: 'Synkk AI: Run Vault Gardener',
      callback: async () => {
        if (this.settings.e2eeEnabled) {
          new Notice('Synkk Gardener is unavailable in Zero-Knowledge E2EE mode.');
          return;
        }
        if (!this.settings.selectedVaultSlug) {
          new Notice('Synkk: Please select a target vault in settings first.');
          return;
        }
        new Notice('Synkk: Running Vault Gardener scan...');
        try {
          const res = await this.apiClient.runGardener(this.settings.selectedVaultSlug);
          new Notice(
            `Synkk Gardener scanned ${res.files_scanned} notes and created ${res.proposals_created} proposal(s).`
          );
          await this.refreshProposalsBadge();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`Synkk Gardener failed: ${msg}`);
        }
      },
    });

    // Command: Run Pre-Flight Vault Scan & Migration Wizard
    this.addCommand({
      id: 'open-migration-wizard',
      name: 'Vault Migration: Run Pre-Flight Diagnostic & Migration Wizard',
      callback: async () => {
        const { SynkkMigrationWizardModal } = await import('./migrationWizardModal');
        new SynkkMigrationWizardModal(this.app, this).open();
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

    // Check pending AI proposals badge quietly after startup
    window.setTimeout(() => {
      void this.refreshProposalsBadge();
    }, 3500);
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
    const rawData = ((await this.loadData()) as Partial<SynkkSettings> | null) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);

    // P1-01 Security Migration: Never persist plaintext E2EE passphrase to disk.
    // If a legacy data.json contains e2eePassphrase, keep it in memory for the active
    // session, but immediately sanitize and strip it from the persisted settings file.
    if (rawData.e2eePassphrase) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    // P1-01 Security Hardening: Never persist plaintext E2EE passphrase to disk.
    // The passphrase remains exclusively in memory for the active session.
    const sanitized: Partial<SynkkSettings> = { ...this.settings };
    delete sanitized.e2eePassphrase;
    await this.saveData(sanitized);
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
      if (status !== 'Synkk: Ready' && !status.toLowerCase().includes('error')) {
        const now = Date.now();
        if (now - this.lastBadgeRefreshAt > 5000) {
          this.lastBadgeRefreshAt = now;
          void this.refreshProposalsBadge();
        }
      }
    }
  }

  public async activateAiSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SYNKK_AI_VIEW_TYPE);
    let targetLeaf = existing[0] ?? null;

    if (!targetLeaf) {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: SYNKK_AI_VIEW_TYPE,
          active: true,
        });
        targetLeaf = rightLeaf;
      }
    }

    if (targetLeaf) {
      await this.app.workspace.revealLeaf(targetLeaf);
      if (targetLeaf.view instanceof SynkkAiSidebarView) {
        void targetLeaf.view.refreshState();
      }
    } else if (this.settings.selectedVaultSlug) {
      new VaultCopilotModal(this.app, this.apiClient, this.settings.selectedVaultSlug).open();
    }
  }

  public refreshAiViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(SYNKK_AI_VIEW_TYPE)) {
      if (leaf.view instanceof SynkkAiSidebarView) {
        void leaf.view.refreshState();
      }
    }
    void this.refreshProposalsBadge();
  }

  public async refreshProposalsBadge(): Promise<void> {
    if (!this.proposalsBadgeEl) {
      return;
    }

    if (
      this.settings.e2eeEnabled ||
      !this.settings.aiShowProposalsBadge ||
      !this.settings.ragEnabled ||
      !this.settings.selectedVaultSlug ||
      !this.settings.deviceToken
    ) {
      this.proposalsBadgeEl.addClass('synkk-hidden');
      this.proposalsBadgeEl.setText('');
      return;
    }

    try {
      const res = await this.apiClient.listAiProposals(
        this.settings.selectedVaultSlug,
        'pending',
        false
      );
      const count = res.proposals?.length ?? 0;
      const badge = formatProposalsBadgeText(count);
      if (!badge) {
        this.proposalsBadgeEl.addClass('synkk-hidden');
        this.proposalsBadgeEl.setText('');
      } else {
        this.proposalsBadgeEl.removeClass('synkk-hidden');
        this.proposalsBadgeEl.setText(badge);
      }
    } catch {
      // Keep status bar clean if server is temporarily unreachable
    }
  }
}
