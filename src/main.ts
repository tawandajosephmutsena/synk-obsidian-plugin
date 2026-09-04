import { Notice, Plugin } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { SynkkSettingTab } from './settings';
import { SynkkSyncEngine } from './syncEngine';
import { DEFAULT_SETTINGS, SynkkSettings } from './types';

export default class SynkkPlugin extends Plugin {
  settings: SynkkSettings;
  apiClient: SynkkApiClient;
  syncEngine: SynkkSyncEngine;
  private statusBarEl: HTMLElement;
  private syncIntervalId: number | null = null;

  async onload() {
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

    // Status bar indicator
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('synkk-status-bar');
    this.updateStatusBar('Synkk: Ready', false);
    this.statusBarEl.onClickEvent(() => {
      this.syncEngine.sync();
    });

    // Left Ribbon Icon (Sync Now)
    this.addRibbonIcon('sync', 'Synkk: Sync Now', async () => {
      await this.syncEngine.sync();
    });

    // Command: Sync Now
    this.addCommand({
      id: 'synkk-sync-now',
      name: 'Synchronize Now',
      callback: async () => {
        await this.syncEngine.sync();
      },
    });

    // Settings Tab
    this.addSettingTab(new SynkkSettingTab(this.app, this));

    // Schedule Auto-Sync
    this.configureAutoSync();

    // Sync on Startup if configured
    if (this.settings.syncOnStartup && this.settings.deviceToken && this.settings.selectedVaultSlug) {
      setTimeout(() => {
        this.syncEngine.sync();
      }, 2000);
    }
  }

  onunload() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
          this.syncEngine.sync();
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
      const spin = this.statusBarEl.createSpan({ cls: 'synkk-sync-spin', text: '🔄' });
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
