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

    containerEl.createEl('h4', { text: '.obsidian configuration' });

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
