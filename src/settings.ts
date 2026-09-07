import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SynkkPlugin from './main';

export class SynkkSettingTab extends PluginSettingTab {
  plugin: SynkkPlugin;

  constructor(app: App, plugin: SynkkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Synkk Vault Sync Settings' });

    // Server Info Banner
    const infoBox = containerEl.createDiv({ cls: 'synkk-settings-info' });
    infoBox.createEl('p', {
      text: 'Synchronize this Obsidian vault with your Synkk team server. Fully compatible with Mac, Windows PC, iPhone (iOS), and Android.',
    });

    // Instant Quick Connect (QR payload or connect string)
    new Setting(containerEl)
      .setName('⚡ Instant Quick Connect')
      .setDesc('Paste your mobile QR scan code, 2-second pairing session JSON, or device token to auto-configure in 1 second.')
      .addText((text) => {
        text
          .setPlaceholder('Paste QR session JSON {"v":2,"type":"synkk-pairing-session",...} or token')
          .onChange(async (val) => {
            const trimmed = val.trim();
            if (!trimmed) return;

            try {
              let parsed: any = null;

              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                parsed = JSON.parse(trimmed);
              } else if (trimmed.startsWith('synkk://')) {
                const url = new URL(trimmed.replace('synkk://', 'http://synkk-placeholder/'));
                parsed = {
                  server: url.searchParams.get('server') || undefined,
                  token: url.searchParams.get('token') || undefined,
                  vault: url.searchParams.get('vault') || undefined,
                };
              } else if (trimmed.startsWith('synkk_')) {
                parsed = { token: trimmed };
              }

              if (parsed?.type === 'synkk-pairing-session' && parsed.session && parsed.server) {
                new Notice('⚡ Exchanging 2-second pairing session with Synkk...');
                try {
                  const { SynkkApiClient } = await import('./apiClient');
                  const exRes = await SynkkApiClient.exchangePairing(parsed.server, parsed.session, 'Obsidian Client', 'ios');
                  this.plugin.settings.serverUrl = exRes.server_url;
                  this.plugin.settings.deviceToken = exRes.plain_token;
                  if (exRes.vault_slug) {
                    this.plugin.settings.selectedVaultSlug = exRes.vault_slug;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.apiClient.updateConfig(exRes.server_url, exRes.plain_token);
                  new Notice(`⚡ Synkk paired instantly! Linked to team ${exRes.team_slug}.`);
                  this.display();
                  return;
                } catch (e: any) {
                  new Notice(`Pairing session error: ${e.message}`);
                  return;
                }
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

                this.display(); // Refresh settings tab view
              }
            } catch (err: any) {
              new Notice(`Quick Connect error: ${err.message || 'Invalid format'}`);
            }
          });
      });

    // Server URL
    new Setting(containerEl)
      .setName('Server API URL')
      .setDesc('Your Synkk backend endpoint (e.g. https://synkk.ottomate.space/api/v1)')
      .addText((text) =>
        text
          .setPlaceholder('https://synkk.ottomate.space/api/v1')
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
              this.display(); // Refresh UI with populated dropdown
            } catch (err: any) {
              new Notice(`Connection failed: ${err.message || 'Unknown error'}`);
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

    containerEl.createEl('h3', { text: 'Selective Sync & Configuration' });

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

    containerEl.createEl('h4', { text: 'Vault Environment & Plugin Suite Sync' });

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
      .setDesc('Sync files under .obsidian/snippets.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncSnippets).onChange(async (value) => {
          this.plugin.settings.syncSnippets = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Sync plugin data')
      .setDesc('Sync files under .obsidian/plugins. Only enable this for plugins whose data is safe across device types.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncPluginData).onChange(async (value) => {
          this.plugin.settings.syncPluginData = value;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: 'Atomic Safety Shield' });

    new Setting(containerEl)
      .setName('Deletion safety threshold')
      .setDesc('Stop a sync when incoming or outgoing deletions exceed this percentage of selected tracked files.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.deletionThresholdPercent)
          .setDynamicTooltip()
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

    containerEl.createEl('h3', { text: '🔒 Zero-Knowledge End-to-End Encryption (E2EE)' });

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
      .setDesc('Shared passphrase used to derive the 256-bit encryption key. Must be identical across all your devices.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Enter secure vault passphrase')
          .setValue(this.plugin.settings.e2eePassphrase)
          .onChange(async (val) => {
            this.plugin.settings.e2eePassphrase = val;
            await this.plugin.saveSettings();
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
            this.display();
          } catch (e: any) {
            new Notice(`E2EE initialization failed: ${e.message}`);
          }
        })
      );

    containerEl.createEl('h3', { text: '👻 Ghost Files (Selective Sync)' });

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

    containerEl.createEl('h3', { text: '⚡ Mobile Background Transport Relays' });

    new Setting(containerEl)
      .setName('Adaptive Background Relays')
      .setDesc('Listen for remote revision pulses and sync immediately when app resumes from background.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mobileBackgroundRelay).onChange(async (val) => {
          this.plugin.settings.mobileBackgroundRelay = val;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h3', { text: 'Sync Schedule & Automation' });

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
  }
}
