import { App, Modal, Notice, Platform } from 'obsidian';
import type SynkkPlugin from './main';
import {
  buildPreflightPayload,
  formatBytes,
  PreflightFrictionItem,
  PreflightScanResult,
  sanitizePath,
  scanObsidianVault,
} from './preflightScanner';
import { VaultPreflightResponse } from './types';

type WizardStep = 1 | 2 | 3 | 4;

export class SynkkMigrationWizardModal extends Modal {
  private plugin: SynkkPlugin;
  private currentStep: WizardStep = 1;
  private scanResult: PreflightScanResult | null = null;
  private preflightResponse: VaultPreflightResponse | null = null;
  private isScanning: boolean = false;
  private isSimulating: boolean = false;
  private isExecuting: boolean = false;

  // Preset configuration state
  private presetExcludeTrashGit: boolean = true;
  private presetEnableGhostFiles: boolean = true;
  private presetExcludeGiantMedia: boolean = false;
  private giantMediaThresholdMb: number = 25;

  constructor(app: App, plugin: SynkkPlugin) {
    super(app);
    this.plugin = plugin;
    this.presetEnableGhostFiles = this.plugin.settings.ghostFilesEnabled ?? true;
  }

  public async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('synkk-migration-modal');

    await this.runScan();
    this.render();
  }

  public onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async runScan(): Promise<void> {
    this.isScanning = true;
    try {
      this.scanResult = await scanObsidianVault(this.app, {
        settings: this.plugin.settings,
        isMobile: Platform.isMobile,
        oversizedThresholdBytes: this.giantMediaThresholdMb * 1024 * 1024,
      });
    } catch (err) {
      console.error('Preflight scan error:', err);
      new Notice('Error scanning vault files for pre-flight check.');
    } finally {
      this.isScanning = false;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Modal Header
    const header = contentEl.createDiv({ cls: 'synkk-wizard-header' });
    header.createEl('div', { cls: 'synkk-wizard-icon', text: '🛫' });
    const headerText = header.createDiv({ cls: 'synkk-wizard-title-group' });
    headerText.createEl('h2', {
      text: 'Vault Pre-Flight & Migration Engine',
      cls: 'synkk-wizard-title',
    });
    headerText.createEl('p', {
      text: 'Diagnostic safety scan, friction detection, and zero-loss migration wizard.',
      cls: 'synkk-wizard-sub',
    });

    // Stepper indicator
    const stepper = contentEl.createDiv({ cls: 'synkk-wizard-stepper' });
    this.renderStepIndicator(stepper, 1, '1. Diagnostic Scan');
    this.renderStepIndicator(stepper, 2, '2. Exclusion Presets');
    this.renderStepIndicator(stepper, 3, '3. Server Simulation');
    this.renderStepIndicator(stepper, 4, '4. Migration Sync');

    // Step Body Container
    const body = contentEl.createDiv({ cls: 'synkk-wizard-body' });

    if (this.isScanning) {
      const loadingBox = body.createDiv({ cls: 'synkk-wizard-loading' });
      loadingBox.createEl('div', { cls: 'synkk-sync-spin', text: '⚡' });
      loadingBox.createEl('p', { text: 'Running pre-flight vault analysis…' });
      return;
    }

    switch (this.currentStep) {
      case 1:
        this.renderStep1(body);
        break;
      case 2:
        this.renderStep2(body);
        break;
      case 3:
        this.renderStep3(body);
        break;
      case 4:
        this.renderStep4(body);
        break;
    }
  }

  private renderStepIndicator(container: HTMLElement, step: WizardStep, title: string): void {
    const stepEl = container.createDiv({
      cls: `synkk-step-item ${this.currentStep === step ? 'is-active' : ''} ${
        this.currentStep > step ? 'is-completed' : ''
      }`,
    });
    stepEl.createSpan({ cls: 'synkk-step-num', text: String(step) });
    stepEl.createSpan({ cls: 'synkk-step-name', text: title.substring(3) });
  }

  // ==========================================
  // STEP 1: Vault Health Diagnostic
  // ==========================================
  private renderStep1(container: HTMLElement): void {
    if (!this.scanResult) return;

    // Overview Stats Banner
    const statsGrid = container.createDiv({ cls: 'synkk-stats-grid' });

    const totalFilesCard = statsGrid.createDiv({ cls: 'synkk-stat-card' });
    totalFilesCard.createEl('div', { text: 'Total Vault Files', cls: 'synkk-stat-label' });
    totalFilesCard.createEl('div', {
      text: `${this.scanResult.totalFiles.toLocaleString()} files`,
      cls: 'synkk-stat-val',
    });

    const totalSizeCard = statsGrid.createDiv({ cls: 'synkk-stat-card' });
    totalSizeCard.createEl('div', { text: 'Total Vault Footprint', cls: 'synkk-stat-label' });
    totalSizeCard.createEl('div', {
      text: formatBytes(this.scanResult.totalBytes),
      cls: 'synkk-stat-val',
    });

    const frictionCard = statsGrid.createDiv({ cls: 'synkk-stat-card' });
    frictionCard.createEl('div', { text: 'Friction Flags', cls: 'synkk-stat-label' });
    const frictionCount = this.scanResult.frictionItems.length;
    frictionCard.createEl('div', {
      text: frictionCount === 0 ? '✨ 0 Issues' : `⚠️ ${frictionCount} detected`,
      cls: `synkk-stat-val ${frictionCount > 0 ? 'color-warning' : 'color-success'}`,
    });

    // Category Composition Pills
    container.createEl('h4', { text: 'Vault Composition by Type', cls: 'synkk-section-title' });
    const pillRow = container.createDiv({ cls: 'synkk-category-pills' });

    const catLabels: Record<string, { label: string; icon: string }> = {
      markdown: { label: 'Markdown Notes', icon: '📝' },
      canvas: { label: 'Canvases', icon: '🎨' },
      images: { label: 'Images', icon: '🖼️' },
      audio_video: { label: 'Media', icon: '🎬' },
      pdf: { label: 'PDF Documents', icon: '📄' },
      config: { label: 'Config / Plugins', icon: '⚙️' },
      other: { label: 'Other', icon: '📁' },
    };

    for (const [catKey, meta] of Object.entries(catLabels)) {
      const summary = this.scanResult.categories[catKey as keyof typeof this.scanResult.categories];
      if (summary && summary.count > 0) {
        const pill = pillRow.createDiv({ cls: 'synkk-category-pill' });
        pill.createSpan({ text: `${meta.icon} ${meta.label}: ` });
        pill.createEl('strong', { text: `${summary.count} (${formatBytes(summary.bytes)})` });
      }
    }

    // Friction & Risk Items
    container.createEl('h4', { text: 'Pre-Flight Diagnostic & Friction Risks', cls: 'synkk-section-title' });
    const frictionList = container.createDiv({ cls: 'synkk-friction-list' });

    if (this.scanResult.frictionItems.length === 0) {
      const cleanBanner = frictionList.createDiv({ cls: 'synkk-clean-banner' });
      cleanBanner.createEl('span', { text: '🛡️ Vault Verified Clean: No path conflicts, oversized hazards, or invalid file names detected.' });
    } else {
      const sampleItems = this.scanResult.frictionItems.slice(0, 5);
      for (const item of sampleItems) {
        const itemEl = frictionList.createDiv({ cls: `synkk-friction-item mod-${item.type}` });
        const iconSpan = itemEl.createSpan({ cls: 'synkk-friction-icon' });
        iconSpan.setText(item.type === 'invalid_chars' ? '🛑' : '⚠️');

        const detail = itemEl.createDiv({ cls: 'synkk-friction-detail' });
        detail.createEl('div', { text: item.path, cls: 'synkk-friction-path' });
        detail.createEl('div', { text: `${item.message} — ${item.suggestedAction}`, cls: 'synkk-friction-msg' });
      }

      if (this.scanResult.frictionItems.length > 5) {
        frictionList.createEl('p', {
          text: `…and ${this.scanResult.frictionItems.length - 5} more friction flags found.`,
          cls: 'synkk-more-notice',
        });
      }

      // If invalid chars exist, offer one-click Auto-Sanitize
      const invalidCharsFound = this.scanResult.frictionItems.filter((i) => i.type === 'invalid_chars');
      if (invalidCharsFound.length > 0) {
        const sanitizeRow = container.createDiv({ cls: 'synkk-sanitize-box' });
        sanitizeRow.createEl('p', {
          text: `Found ${invalidCharsFound.length} notes with characters incompatible with Windows, iOS, or Android (: * ? " < > |).`,
        });
        const sanitizeBtn = sanitizeRow.createEl('button', {
          text: '⚡ Auto-Sanitize Unsafe File Names',
          cls: 'mod-cta',
        });
        sanitizeBtn.onclick = async () => {
          let renamed = 0;
          for (const item of invalidCharsFound) {
            const safe = sanitizePath(item.path);
            if (safe !== item.path) {
              const file = this.app.vault.getAbstractFileByPath(item.path);
              if (file) {
                try {
                  await this.app.fileManager.renameFile(file, safe);
                  renamed++;
                } catch (e) {
                  console.error('Error renaming:', e);
                }
              }
            }
          }
          new Notice(`Synkk: Renamed ${renamed} files to cross-platform safe paths.`);
          await this.runScan();
          this.render();
        };
      }
    }

    // Action Footer
    const footer = container.createDiv({ cls: 'synkk-wizard-footer' });
    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const nextBtn = footer.createEl('button', {
      text: 'Next: Exclusion Presets →',
      cls: 'mod-cta',
    });
    nextBtn.onclick = () => {
      this.currentStep = 2;
      this.render();
    };
  }

  // ==========================================
  // STEP 2: One-Click Exclusion & Optimization Presets
  // ==========================================
  private renderStep2(container: HTMLElement): void {
    container.createEl('h3', { text: 'Configure Migration Presets & Rules' });
    container.createEl('p', {
      text: 'Select recommended rules to reduce bandwidth, avoid syncing junk files, and protect repository integrity.',
      cls: 'synkk-wizard-sub',
    });

    const optionsBox = container.createDiv({ cls: 'synkk-options-box' });

    // Preset 1: Exclude .trash and .git
    const p1 = optionsBox.createDiv({ cls: 'synkk-checkbox-row' });
    const check1 = p1.createEl('input', { type: 'checkbox' });
    check1.checked = this.presetExcludeTrashGit;
    check1.id = 'synkk-preset-trash';
    check1.onchange = () => {
      this.presetExcludeTrashGit = check1.checked;
      this.updateCalculatedSavings();
    };
    const label1 = p1.createEl('label', { attr: { for: 'synkk-preset-trash' } });
    label1.createEl('strong', { text: '🛡️ Automatically Exclude .trash and .git directories (Recommended)' });
    label1.createEl('p', {
      text: 'Protects team storage quota from discarded files and prevents corrupted Git repositories.',
      cls: 'synkk-desc-text',
    });

    // Preset 2: Enable Ghost Files for Mobile
    const p2 = optionsBox.createDiv({ cls: 'synkk-checkbox-row' });
    const check2 = p2.createEl('input', { type: 'checkbox' });
    check2.checked = this.presetEnableGhostFiles;
    check2.id = 'synkk-preset-ghost';
    check2.onchange = () => {
      this.presetEnableGhostFiles = check2.checked;
      this.updateCalculatedSavings();
    };
    const label2 = p2.createEl('label', { attr: { for: 'synkk-preset-ghost' } });
    label2.createEl('strong', { text: '👻 Enable Mobile Ghost Files (Stubs on Mobile)' });
    label2.createEl('p', {
      text: 'Large attachments (> 5MB) are turned into instant lightweight stubs on phone devices to save gigabytes of mobile storage.',
      cls: 'synkk-desc-text',
    });

    // Preset 3: Exclude giant media
    const p3 = optionsBox.createDiv({ cls: 'synkk-checkbox-row' });
    const check3 = p3.createEl('input', { type: 'checkbox' });
    check3.checked = this.presetExcludeGiantMedia;
    check3.id = 'synkk-preset-giant';
    check3.onchange = () => {
      this.presetExcludeGiantMedia = check3.checked;
      this.updateCalculatedSavings();
    };
    const label3 = p3.createEl('label', { attr: { for: 'synkk-preset-giant' } });
    label3.createEl('strong', { text: `📦 Keep Giant Files (> ${this.giantMediaThresholdMb}MB) Local` });
    label3.createEl('p', {
      text: 'Heavy videos, zip files, and archives stay safe on your desktop machine without consuming cloud limits.',
      cls: 'synkk-desc-text',
    });

    // Live Savings Card
    const savingsCard = container.createDiv({ cls: 'synkk-savings-card', attr: { id: 'synkk-savings-card' } });
    this.renderSavingsCard(savingsCard);

    // Footer
    const footer = container.createDiv({ cls: 'synkk-wizard-footer' });
    const backBtn = footer.createEl('button', { text: '← Back' });
    backBtn.onclick = () => {
      this.currentStep = 1;
      this.render();
    };

    const nextBtn = footer.createEl('button', {
      text: 'Next: Server Simulation Dry-Run →',
      cls: 'mod-cta',
    });
    nextBtn.onclick = async () => {
      // Apply chosen presets to plugin settings
      this.plugin.settings.ghostFilesEnabled = this.presetEnableGhostFiles;
      await this.plugin.saveSettings();
      await this.runScan(); // refresh scan with new options
      this.currentStep = 3;
      this.render();
      await this.executeServerSimulation();
    };
  }

  private updateCalculatedSavings(): void {
    const el = this.contentEl.querySelector('#synkk-savings-card');
    if (el instanceof HTMLElement) {
      this.renderSavingsCard(el);
    }
  }

  private renderSavingsCard(card: HTMLElement): void {
    card.empty();
    if (!this.scanResult) return;

    let estimatedSavingsBytes = this.scanResult.savingsBytes;

    if (this.presetExcludeGiantMedia) {
      for (const item of this.scanResult.frictionItems) {
        if (item.type === 'oversized') {
          estimatedSavingsBytes += item.size;
        }
      }
    }

    const pct = this.scanResult.totalBytes > 0
      ? Math.min(100, Math.round((estimatedSavingsBytes / this.scanResult.totalBytes) * 100))
      : 0;

    card.createEl('div', { text: '⚡ Estimated Bandwidth & Storage Saved', cls: 'synkk-savings-title' });
    card.createEl('div', {
      text: `${formatBytes(estimatedSavingsBytes)} (${pct}% reduction)`,
      cls: 'synkk-savings-value',
    });
    card.createEl('p', {
      text: 'Applying these presets prevents unnecessary data uploads and ensures seamless synchronization across mobile and desktop devices.',
      cls: 'synkk-savings-desc',
    });
  }

  // ==========================================
  // STEP 3: Server Simulation Dry-Run
  // ==========================================
  private renderStep3(container: HTMLElement): void {
    container.createEl('h3', { text: 'Server Migration Simulation' });
    container.createEl('p', {
      text: 'Validating payload against server quotas and calculating delta without transmitting file data.',
      cls: 'synkk-wizard-sub',
    });

    const simContainer = container.createDiv({ cls: 'synkk-simulation-container', attr: { id: 'synkk-sim-container' } });

    if (this.isSimulating) {
      const load = simContainer.createDiv({ cls: 'synkk-wizard-loading' });
      load.createEl('div', { cls: 'synkk-sync-spin', text: '🔄' });
      load.createEl('p', { text: 'Simulating migration on Synkk server…' });
    } else if (this.preflightResponse) {
      this.renderSimulationResults(simContainer);
    }

    const footer = container.createDiv({ cls: 'synkk-wizard-footer' });
    const backBtn = footer.createEl('button', { text: '← Back' });
    backBtn.onclick = () => {
      this.currentStep = 2;
      this.render();
    };

    const startBtn = footer.createEl('button', {
      text: '🚀 Start Guarded Migration Sync',
      cls: 'mod-cta',
    });
    startBtn.disabled = this.isSimulating || Boolean(this.preflightResponse !== null && !this.preflightResponse.authorized);
    startBtn.onclick = async () => {
      this.currentStep = 4;
      this.render();
      await this.runMigrationSync();
    };
  }

  private async executeServerSimulation(): Promise<void> {
    if (!this.scanResult) return;

    this.isSimulating = true;
    const simBox = this.contentEl.querySelector('#synkk-sim-container');
    if (simBox instanceof HTMLElement) {
      simBox.empty();
      const load = simBox.createDiv({ cls: 'synkk-wizard-loading' });
      load.createEl('div', { cls: 'synkk-sync-spin', text: '🔄' });
      load.createEl('p', { text: 'Verifying team quota and calculating sync delta…' });
    }

    try {
      const vaultSlug = this.plugin.settings.selectedVaultSlug;
      if (!vaultSlug) {
        new Notice('Synkk: Please select a vault in settings first.');
        this.isSimulating = false;
        return;
      }

      const payload = buildPreflightPayload(this.scanResult);
      this.preflightResponse = await this.plugin.apiClient.vaultPreflight(vaultSlug, payload);
    } catch (err: unknown) {
      console.error('Simulation error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Simulation failed: ${msg}`);
    } finally {
      this.isSimulating = false;
      this.render();
    }
  }

  private renderSimulationResults(container: HTMLElement): void {
    if (!this.preflightResponse) return;

    const res = this.preflightResponse;

    // Quota Banner
    if (res.status === 'quota_exceeded' || !res.quota?.allowed) {
      const errorCard = container.createDiv({ cls: 'synkk-quota-exceeded-card' });
      errorCard.createEl('h4', { text: '🚨 Quota Exceeded: Insufficient Team Storage' });
      const deficit = formatBytes(res.quota?.deficit_bytes || 0);
      errorCard.createEl('p', {
        text: `The initial sync payload exceeds your team quota by ${deficit}. Please exclude heavy folders in Step 2 or upgrade your Synkk plan.`,
      });
      return;
    }

    // Success Simulation Cards
    const simGrid = container.createDiv({ cls: 'synkk-stats-grid' });

    const upCard = simGrid.createDiv({ cls: 'synkk-stat-card' });
    upCard.createEl('div', { text: 'Files to Upload', cls: 'synkk-stat-label' });
    upCard.createEl('div', {
      text: `⬆️ ${res.simulation?.to_upload_count ?? res.vault?.server_files_count ?? 0}`,
      cls: 'synkk-stat-val color-accent',
    });

    const downCard = simGrid.createDiv({ cls: 'synkk-stat-card' });
    downCard.createEl('div', { text: 'Files to Pull', cls: 'synkk-stat-label' });
    downCard.createEl('div', {
      text: `⬇️ ${res.simulation?.to_download_count ?? 0}`,
      cls: 'synkk-stat-val',
    });

    const skipCard = simGrid.createDiv({ cls: 'synkk-stat-card' });
    skipCard.createEl('div', { text: 'Identical Files Skipped', cls: 'synkk-stat-label' });
    skipCard.createEl('div', {
      text: `⚡ ${res.simulation?.identical_skipped_count ?? 0}`,
      cls: 'synkk-stat-val color-success',
    });

    // Quota and Safety details
    const detailBox = container.createDiv({ cls: 'synkk-detail-box' });
    const remaining = formatBytes(res.quota?.remaining_bytes || 0);
    const limit = formatBytes(res.quota?.storage_limit_bytes || 0);

    detailBox.createEl('p', {
      text: `🛡️ Atomic Safety Shield is Active (max bulk deletion limit: ${res.safety?.max_deletion_threshold_percent ?? 20}%).`,
    });
    detailBox.createEl('p', {
      text: `📊 Team Storage Status: ${remaining} available out of ${limit} quota limit.`,
    });
  }

  // ==========================================
  // STEP 4: Live Execution & Completion
  // ==========================================
  private renderStep4(container: HTMLElement): void {
    container.createEl('h3', { text: 'Executing Vault Migration' });

    const execContainer = container.createDiv({ cls: 'synkk-execution-container' });

    if (this.isExecuting) {
      const progressBox = execContainer.createDiv({ cls: 'synkk-progress-box' });
      progressBox.createEl('div', { cls: 'synkk-progress-bar-container' }).createDiv({
        cls: 'synkk-progress-bar-pulse',
      });
      progressBox.createEl('p', {
        text: 'Synchronizing vault files with batch chunking and Zero-Knowledge encryption…',
        cls: 'synkk-progress-text',
      });
    } else {
      // Completed State
      const completeCard = execContainer.createDiv({ cls: 'synkk-complete-card' });
      completeCard.createEl('div', { cls: 'synkk-complete-seal', text: '✅' });
      completeCard.createEl('h3', { text: 'Vault Migration Verified & Complete!' });
      completeCard.createEl('p', {
        text: 'Your Obsidian vault is fully synchronized with your Synkk team server. Live collaboration and real-time push/pull are now active.',
        cls: 'synkk-complete-sub',
      });

      const closeBtn = execContainer.createEl('button', {
        text: 'Close & Open Vault',
        cls: 'mod-cta synkk-complete-btn',
      });
      closeBtn.onclick = () => this.close();
    }
  }

  private async runMigrationSync(): Promise<void> {
    this.isExecuting = true;
    try {
      const result = await this.plugin.syncEngine.sync();
      if (result.errors > 0) {
        new Notice(`Synkk Migration completed with ${result.errors} notice(s). Check status bar.`);
      } else {
        new Notice(`Synkk Migration Success: Synced ${result.pushed} uploaded, ${result.pulled} pulled.`);
      }
    } catch (err: unknown) {
      console.error('Migration execution error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Migration error: ${msg}`);
    } finally {
      this.isExecuting = false;
      this.render();
    }
  }
}
