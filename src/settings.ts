import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import type SynkkPlugin from './main';


export class SynkkSettingTab extends PluginSettingTab {
  plugin: SynkkPlugin;

  constructor(app: App, plugin: SynkkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Synkk Vault Sync').setHeading();

    // Server Info Banner
    const infoBox = containerEl.createDiv({ cls: 'synkk-settings-info' });
    infoBox.createEl('p', {
      text: 'Synchronize this Obsidian vault with your Synkk team server. Fully compatible with Mac, Windows PC, iPhone (iOS), and Android.',
    });

    // Instant Quick Connect (QR payload or connect string)
    new Setting(containerEl)
      .setName('⚡ One-Scan Quick Connect')
      .setDesc('Point camera at Synkk dashboard QR code, select QR photo, or paste your pairing link.')
      .addButton((btn) => {
        btn
          .setButtonText('📷 Scan QR Code')
          .setCta()
          .onClick(async () => {
            const { SynkkPairingModal } = await import('./pairingModal');
            new SynkkPairingModal(this.app, this.plugin).open();
          });
      })
      .addText((text) => {
        text
          .setPlaceholder('Paste obsidian://synkk-pair?... URL, /pair?... link, or token')
          .onChange(async (val) => {
            const trimmed = val.trim();
            if (!trimmed) return;

            try {
              const { parsePairingPayload, handlePairingProtocol } = await import('./pairing');
              const parsed = parsePairingPayload(trimmed);

              if (parsed?.type === 'synkk-pairing-session' && parsed.session && parsed.server) {
                await handlePairingProtocol(this.plugin, parsed);
                this.renderSettings();
                return;
              }

              if (parsed && (parsed.server || parsed.token || parsed.vault)) {
                if (parsed.server) {
                  this.plugin.settings.serverUrl = parsed.server.trim();
                }
                if (parsed.token) {
                  this.plugin.settings.deviceToken = parsed.token.trim();
                }
                if (parsed.vault) {
                  this.plugin.settings.selectedVaultSlug = parsed.vault.trim();
                }

                await this.plugin.saveSettings();
                this.plugin.apiClient.updateConfig(this.plugin.settings.serverUrl, this.plugin.settings.deviceToken);

                // Auto-verify connection
                try {
                  const authRes = await this.plugin.apiClient.verifyAuth();
                  const vaults = await this.plugin.apiClient.getVaults();
                  new Notice(`⚡ Synkk paired instantly! Connected as ${authRes.user.name} (${authRes.team.name}) with ${vaults.length} vaults.`);
                } catch {
                  new Notice('⚡ Quick Connect applied! Please click "Verify & Load Vaults" below.');
                }

                this.renderSettings(); // Refresh settings tab view
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Quick Connect error: ${msg || 'Invalid format'}`);
            }
          });
      });

    // Server URL
    new Setting(containerEl)
      .setName('Server API URL')
      .setDesc('Your Synkk backend endpoint (e.g. https://synkk.space/api/v1)')
      .addText((text) =>
        text
          .setPlaceholder('https://synkk.space/api/v1')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
            this.plugin.apiClient.updateConfig(this.plugin.settings.serverUrl, this.plugin.settings.deviceToken);
          })
      );

    // Device Token
    new Setting(containerEl)
      .setName('Device Sync Token')
      .setDesc('Personal device token generated in your Synkk dashboard')
      .addText((text) =>
        text
          .setPlaceholder('synkk_xxxxxxxxxxxx')
          .setValue(this.plugin.settings.deviceToken)
          .onChange(async (value) => {
            this.plugin.settings.deviceToken = value.trim();
            await this.plugin.saveSettings();
            this.plugin.apiClient.updateConfig(this.plugin.settings.serverUrl, this.plugin.settings.deviceToken);
          })
      );

    // Test Connection Button
    new Setting(containerEl)
      .setName('Test Connection & Fetch Vaults')
      .setDesc('Verify your token and load your team vaults')
      .addButton((btn) =>
        btn
          .setButtonText('Verify & Load Vaults')
          .setCta()
          .onClick(async () => {
            try {
              btn.setDisabled(true);
              btn.setButtonText('Checking...');

              this.plugin.apiClient.updateConfig(this.plugin.settings.serverUrl, this.plugin.settings.deviceToken);
              const authRes = await this.plugin.apiClient.verifyAuth();
              const vaults = await this.plugin.apiClient.getVaults();

              new Notice(`Connected as ${authRes.user.name} (${authRes.team.name})! Loaded ${vaults.length} vaults.`);
              this.renderSettings(); // Refresh UI with populated dropdown
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Connection failed: ${msg || 'Unknown error'}`);
            } finally {
              btn.setDisabled(false);
              btn.setButtonText('Verify & Load Vaults');
            }
          })
      );

    // Vault Selector
    const vaultSetting = new Setting(containerEl)
      .setName('Target Vault')
      .setDesc('Select the team vault to synchronize with this device');

    vaultSetting.addDropdown(async (dropdown) => {
      dropdown.addOption('', '-- Select a Vault --');

      try {
        if (this.plugin.settings.deviceToken) {
          const vaults = await this.plugin.apiClient.getVaults();
          for (const v of vaults) {
            dropdown.addOption(v.slug, `${v.name} (${v.default_permission})`);
          }
        }
      } catch {
        // Not connected yet
      }

      dropdown.setValue(this.plugin.settings.selectedVaultSlug);
      dropdown.onChange(async (slug) => {
        this.plugin.settings.selectedVaultSlug = slug;
        await this.plugin.saveSettings();
        new Notice(`Target vault set to: ${slug}`);
      });
    });

    new Setting(containerEl).setName('Selective Sync & Configuration').setHeading();

    new Setting(containerEl)
      .setName('Include folders')
      .setDesc('Optional newline-separated vault folder prefixes. Leave blank to sync all eligible files.')
      .addTextArea((text) =>
        text
          .setPlaceholder('00-Inbox\nDaily Notes')
          .setValue(this.plugin.settings.includedPaths)
          .onChange(async (value) => {
            this.plugin.settings.includedPaths = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Exclude folders')
      .setDesc('Newline-separated prefixes to keep on this device only, even when included elsewhere.')
      .addTextArea((text) =>
        text
          .setPlaceholder('99-Archive\nattachments/video')
          .setValue(this.plugin.settings.excludedPaths)
          .onChange(async (value) => {
            this.plugin.settings.excludedPaths = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName('Vault Environment & Plugin Suite Sync').setHeading();

    new Setting(containerEl)
      .setName('Sync Plugin Suite & Themes')
      .setDesc('Synchronize community plugins, configurations, themes, and CSS snippets across all devices. Includes automated mobile safety filtering to prevent iOS/Android app crashes.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncPluginSuite).onChange(async (value) => {
          this.plugin.settings.syncPluginSuite = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Sync plugin list')
      .setDesc('Sync community-plugins.json. Layout, workspace, hotkeys, and Synkk local state always remain device-local.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncPluginList).onChange(async (value) => {
          this.plugin.settings.syncPluginList = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Sync CSS snippets')
      .setDesc('Sync files under the snippets configuration folder.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncSnippets).onChange(async (value) => {
          this.plugin.settings.syncSnippets = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Sync plugin data')
      .setDesc('Sync files under the plugins configuration folder. Only enable this for plugins whose data is safe across device types.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncPluginData).onChange(async (value) => {
          this.plugin.settings.syncPluginData = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('Atomic Safety Shield').setHeading();

    new Setting(containerEl)
      .setName('Deletion safety threshold')
      .setDesc('Stop a sync when incoming or outgoing deletions exceed this percentage of selected tracked files.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.deletionThresholdPercent)
          .onChange(async (value) => {
            this.plugin.settings.deletionThresholdPercent = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Allow next guarded sync')
      .setDesc('One-time override for a Safety Shield halt. It is consumed only when a deletion set exceeds your threshold.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.safetyOverrideForNextSync).onChange(async (value) => {
          this.plugin.settings.safetyOverrideForNextSync = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('🔒 Zero-Knowledge End-to-End Encryption (E2EE)').setHeading();

    new Setting(containerEl)
      .setName('Enable Zero-Knowledge E2EE')
      .setDesc('Encrypt all note contents and attachment files locally with WebCrypto AES-256-GCM before uploading.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.e2eeEnabled).onChange(async (val) => {
          this.plugin.settings.e2eeEnabled = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Vault Passphrase')
      .setDesc('Shared passphrase used to derive the 256-bit encryption key in memory. Never persisted to disk for maximum security.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Enter secure vault passphrase')
          .setValue(this.plugin.settings.e2eePassphrase)
          .onChange(async (val) => {
            this.plugin.settings.e2eePassphrase = val;
            if (this.plugin.settings.e2eeSalt) {
              try {
                await this.plugin.syncEngine.e2eeEngine.initialize(val, this.plugin.settings.e2eeSalt);
              } catch (e) {
                console.error('Failed to initialize E2EE engine with new passphrase:', e);
              }
            }
          });
      });

    new Setting(containerEl)
      .setName('Initialize E2EE on Vault')
      .setDesc('Publish client salt and test verification cipher to lock this vault with Zero-Knowledge E2EE.')
      .addButton((btn) =>
        btn.setButtonText('Lock Vault with E2EE').onClick(async () => {
          if (!this.plugin.settings.e2eePassphrase) {
            new Notice('Please enter a vault passphrase first.');
            return;
          }
          if (!this.plugin.settings.selectedVaultSlug) {
            new Notice('Please select a target vault first.');
            return;
          }

          try {
            const { E2eeVaultEngine } = await import('./e2ee');
            const salt = E2eeVaultEngine.generateSalt();
            const engine = new E2eeVaultEngine();
            await engine.initialize(this.plugin.settings.e2eePassphrase, salt);
            const testCipher = await engine.createVerificationCipher();

            await this.plugin.apiClient.enableE2ee(this.plugin.settings.selectedVaultSlug, salt, testCipher);
            this.plugin.settings.e2eeEnabled = true;
            this.plugin.settings.e2eeSalt = salt;
            await this.plugin.saveSettings();

            new Notice('🔒 Zero-Knowledge E2EE successfully enabled on vault!');
            this.renderSettings();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`E2EE initialization failed: ${msg}`);
          }
        })
      );

    new Setting(containerEl).setName('👻 Ghost Files (Selective Sync)').setHeading();

    new Setting(containerEl)
      .setName('Enable On-Demand Ghost Files')
      .setDesc('Replace heavy attachments on mobile with lightweight ghost stubs and stream full binaries on demand.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ghostFilesEnabled).onChange(async (val) => {
          this.plugin.settings.ghostFilesEnabled = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Ghost Attachment Threshold (MB)')
      .setDesc('Attachments larger than this size will be stubbed as ghost files on mobile.')
      .addDropdown((dropdown) => {
        dropdown.addOption('2', '2 MB');
        dropdown.addOption('5', '5 MB (Recommended)');
        dropdown.addOption('10', '10 MB');
        dropdown.addOption('25', '25 MB');
        dropdown.addOption('50', '50 MB');
        dropdown.setValue(String(this.plugin.settings.ghostThresholdMb));
        dropdown.onChange(async (val) => {
          this.plugin.settings.ghostThresholdMb = parseInt(val, 10);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('⚡ Mobile Background Transport Relays').setHeading();

    new Setting(containerEl)
      .setName('Adaptive Background Relays')
      .setDesc('Listen for remote revision pulses and sync immediately when app resumes from background.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mobileBackgroundRelay).onChange(async (val) => {
          this.plugin.settings.mobileBackgroundRelay = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('👥 Real-Time Multiplayer Collaboration').setHeading();

    new Setting(containerEl)
      .setName('Enable Real-Time Collaboration (CRDT)')
      .setDesc('Live cursor presence and real-time multiplayer editing with team members. Keep disabled for standard atomic vault sync.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.realtimeCollaboration).onChange(async (val) => {
          this.plugin.settings.realtimeCollaboration = val;
          await this.plugin.saveSettings();
          if (!val && this.plugin.collabRelay?.currentPath && this.plugin.settings.selectedVaultSlug) {
            await this.plugin.collabRelay.leave(this.plugin.settings.selectedVaultSlug, this.plugin.collabRelay.currentPath);
          }
        })
      );

    new Setting(containerEl).setName('Pre-Flight & Migration Wizard').setHeading();

    new Setting(containerEl)
      .setName('🛫 Pre-Flight Vault Scan & Migration Wizard')
      .setDesc('Run diagnostic safety scan, detect friction risks (.trash, .git, giant media, unsafe paths), simulate dry run on server, and migrate with zero data loss.')
      .addButton((btn) =>
        btn
          .setButtonText('Launch Migration Wizard')
          .setCta()
          .onClick(async () => {
            const { SynkkMigrationWizardModal } = await import('./migrationWizardModal');
            new SynkkMigrationWizardModal(this.app, this.plugin).open();
          })
      );

    new Setting(containerEl).setName('Sync Schedule & Automation').setHeading();

    // Auto-Sync Toggle
    new Setting(containerEl)
      .setName('Automatic Background Sync')
      .setDesc('Periodically sync notes in the background')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (val) => {
          this.plugin.settings.autoSync = val;
          await this.plugin.saveSettings();
          this.plugin.configureAutoSync();
        })
      );

    // Sync Interval
    new Setting(containerEl)
      .setName('Sync Interval (Minutes)')
      .setDesc('How often to check for remote and local changes')
      .addDropdown((dropdown) => {
        dropdown.addOption('1', 'Every 1 minute');
        dropdown.addOption('2', 'Every 2 minutes');
        dropdown.addOption('5', 'Every 5 minutes (Recommended)');
        dropdown.addOption('10', 'Every 10 minutes');
        dropdown.addOption('30', 'Every 30 minutes');
        dropdown.setValue(String(this.plugin.settings.syncIntervalMinutes));
        dropdown.onChange(async (val) => {
          this.plugin.settings.syncIntervalMinutes = parseInt(val, 10);
          await this.plugin.saveSettings();
          this.plugin.configureAutoSync();
        });
      });

    // Sync on Startup
    new Setting(containerEl)
      .setName('Sync on Startup')
      .setDesc('Immediately pull and push changes when Obsidian opens')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (val) => {
          this.plugin.settings.syncOnStartup = val;
          await this.plugin.saveSettings();
        })
      );

    // Sync on File Change
    new Setting(containerEl)
      .setName('Sync on File Change')
      .setDesc('Automatically trigger sync a few seconds after creating, editing, or deleting a note')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnFileChange).onChange(async (val) => {
          this.plugin.settings.syncOnFileChange = val;
          await this.plugin.saveSettings();
        })
      );

    // Manual Sync Button
    new Setting(containerEl)
      .setName('Manual Sync')
      .setDesc('Trigger a synchronization right now')
      .addButton((btn) =>
        btn
          .setButtonText('Sync Now')
          .onClick(async () => {
            await this.plugin.syncEngine.sync();
          })
      );

    new Setting(containerEl).setName('Agentic Knowledge Graph & RAG Server').setHeading();

    new Setting(containerEl)
      .setName('Enable Vault Copilot')
      .setDesc('Query your private notes with local vector embeddings and [[wikilink]] graph traversal.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ragEnabled).onChange(async (val) => {
          this.plugin.settings.ragEnabled = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Re-index Vault Embeddings')
      .setDesc('Trigger remote vector re-indexing for full-vault semantic search and copilot queries.')
      .addButton((btn) =>
        btn.setButtonText('Re-index Vault').onClick(async () => {
          if (!this.plugin.settings.selectedVaultSlug) {
            new Notice('Please select a target vault first.');
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText('Indexing...');
          try {
            const res = await this.plugin.apiClient.ragIndex(this.plugin.settings.selectedVaultSlug, true);
            new Notice(`Re-indexed ${res.files_indexed} notes (${res.chunks_count} chunks) in ${res.duration_ms}ms.`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`Re-indexing failed: ${msg}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('Re-index Vault');
          }
        })
      );
  }
}
