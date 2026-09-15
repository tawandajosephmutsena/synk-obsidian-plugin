import { App, Modal, Notice, Setting } from 'obsidian';
import type SynkkPlugin from './main';

export interface ConflictPair {
  conflictPath: string;
  canonicalPath: string;
  conflictMtime?: number;
}

export function parseConflictPaths(conflictPath: string): { conflictPath: string; canonicalPath: string } {
  let canonicalPath = conflictPath.replace(/(\.sync-conflict-\d+|\.conflict-[^.]+)(\.[^.]+)$/, '$2');
  if (canonicalPath === conflictPath) {
    canonicalPath = conflictPath.replace(/(\.sync-conflict-\d+|\.conflict-[^.]+)$/, '');
  }
  return { conflictPath, canonicalPath };
}

export async function findConflictFiles(app: App): Promise<ConflictPair[]> {
  const files = app.vault.getFiles();
  const conflicts: ConflictPair[] = [];

  for (const file of files) {
    if (file.path.includes('.sync-conflict-') || file.path.includes('.conflict-')) {
      const parsed = parseConflictPaths(file.path);
      conflicts.push({
        conflictPath: parsed.conflictPath,
        canonicalPath: parsed.canonicalPath,
        conflictMtime: file.stat.mtime,
      });
    }
  }

  return conflicts;
}

export class ConflictResolverModal extends Modal {
  plugin: SynkkPlugin;
  conflicts: ConflictPair[] = [];
  selectedConflict: ConflictPair | null = null;
  canonicalText = '';
  conflictText = '';
  mergedText = '';

  constructor(app: App, plugin: SynkkPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '⚡ Synkk Visual Conflict Sandbox' });

    this.conflicts = await findConflictFiles(this.app);

    if (this.conflicts.length === 0) {
      contentEl.createEl('p', {
        text: '🎉 No note conflicts detected! All files in this vault are cleanly synchronized.',
        cls: 'synkk-clean-notice',
      });
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText('Close').onClick(() => this.close())
      );
      return;
    }

    contentEl.createEl('p', {
      text: `Found ${this.conflicts.length} conflict copy in this vault. Select a conflict to review side-by-side differences and reconcile:`,
    });

    if (!this.selectedConflict) {
      this.selectedConflict = this.conflicts[0];
    }

    // Dropdown to pick conflict file if multiple exist
    if (this.conflicts.length > 1) {
      new Setting(contentEl)
        .setName('Conflicted Note')
        .addDropdown((drop) => {
          for (const c of this.conflicts) {
            drop.addOption(c.conflictPath, `${c.canonicalPath} (conflict: ${c.conflictPath})`);
          }
          drop.setValue(this.selectedConflict!.conflictPath);
          drop.onChange(async (val) => {
            this.selectedConflict = this.conflicts.find((c) => c.conflictPath === val) || null;
            await this.loadSelectedConflict();
            this.renderSandbox();
          });
        });
    }

    await this.loadSelectedConflict();
    this.renderSandbox();
  }

  async loadSelectedConflict() {
    if (!this.selectedConflict) return;

    try {
      this.canonicalText = (await this.app.vault.adapter.exists(this.selectedConflict.canonicalPath))
        ? await this.app.vault.adapter.read(this.selectedConflict.canonicalPath)
        : '(Note does not exist on disk)';
    } catch {
      this.canonicalText = '';
    }

    try {
      this.conflictText = (await this.app.vault.adapter.exists(this.selectedConflict.conflictPath))
        ? await this.app.vault.adapter.read(this.selectedConflict.conflictPath)
        : '(Conflict file missing)';
    } catch {
      this.conflictText = '';
    }

    this.mergedText = this.canonicalText;
  }

  renderSandbox() {
    const { contentEl } = this;
    const existingSandbox = contentEl.querySelector('.synkk-sandbox-container');
    if (existingSandbox) {
      existingSandbox.remove();
    }

    const container = contentEl.createDiv({ cls: 'synkk-sandbox-container' });

    // Side-by-Side Comparison Container
    const grid = container.createDiv({
      cls: 'synkk-diff-grid',
      attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0;' },
    });

    // Left column: Canonical
    const leftCol = grid.createDiv({
      attr: { style: 'border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px; background: var(--background-secondary);' },
    });
    leftCol.createEl('strong', { text: `Canonical: ${this.selectedConflict?.canonicalPath}`, attr: { style: 'color: var(--text-accent); font-size: 11px; display: block; margin-bottom: 6px;' } });
    leftCol.createEl('pre', {
      text: this.canonicalText,
      attr: { style: 'max-height: 180px; overflow-y: auto; font-size: 11px; white-space: pre-wrap; margin: 0;' },
    });

    // Right column: Conflict copy
    const rightCol = grid.createDiv({
      attr: { style: 'border: 1px solid var(--color-yellow); border-radius: 8px; padding: 10px; background: var(--background-secondary);' },
    });
    rightCol.createEl('strong', { text: `Conflict Copy: ${this.selectedConflict?.conflictPath}`, attr: { style: 'color: var(--color-yellow); font-size: 11px; display: block; margin-bottom: 6px;' } });
    rightCol.createEl('pre', {
      text: this.conflictText,
      attr: { style: 'max-height: 180px; overflow-y: auto; font-size: 11px; white-space: pre-wrap; margin: 0;' },
    });

    // Action buttons
    const btnRow = container.createDiv({
      attr: { style: 'display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;' },
    });

    const keepOursBtn = btnRow.createEl('button', { text: 'Keep Canonical Version', cls: 'mod-cta' });
    keepOursBtn.onclick = () => {
      this.mergedText = this.canonicalText;
      textArea.value = this.mergedText;
    };

    const keepTheirsBtn = btnRow.createEl('button', { text: 'Keep Conflict Version' });
    keepTheirsBtn.onclick = () => {
      this.mergedText = this.conflictText;
      textArea.value = this.mergedText;
    };

    const combineBtn = btnRow.createEl('button', { text: 'Combine Both' });
    combineBtn.onclick = () => {
      this.mergedText = `${this.canonicalText}\n\n---\n\n${this.conflictText}`;
      textArea.value = this.mergedText;
    };

    // Reconciled Preview Textarea
    container.createEl('label', {
      text: 'Final Reconciled Note Preview (Editable):',
      attr: { style: 'font-weight: bold; font-size: 12px; display: block; margin-bottom: 4px;' },
    });

    const textArea = container.createEl('textarea', {
      attr: { style: 'width: 100%; min-height: 140px; font-family: var(--font-monospace); font-size: 12px; padding: 8px; border-radius: 6px;' },
    });
    textArea.value = this.mergedText;
    textArea.oninput = (e) => {
      this.mergedText = (e.target as HTMLTextAreaElement).value;
    };

    // Footer actions
    const footer = container.createDiv({
      attr: { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;' },
    });

    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const resolveBtn = footer.createEl('button', {
      text: '⚡ Reconcile & Clean Up Conflict',
      cls: 'mod-cta',
      attr: { style: 'background-color: var(--interactive-accent); font-weight: bold;' },
    });
    resolveBtn.onclick = async () => {
      await this.applyResolution();
    };
  }

  async applyResolution() {
    if (!this.selectedConflict) return;

    try {
      // 1. Write reconciled content to canonical path
      await this.app.vault.adapter.write(this.selectedConflict.canonicalPath, this.mergedText);

      // 2. Delete local conflict file
      if (await this.app.vault.adapter.exists(this.selectedConflict.conflictPath)) {
        await this.app.vault.adapter.remove(this.selectedConflict.conflictPath);
      }

      new Notice(`⚡ Reconciled "${this.selectedConflict.canonicalPath}"! Triggering sync to push resolution.`);

      this.close();

      // 3. Trigger immediate sync
      await this.plugin.syncEngine.sync();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Error reconciling conflict: ${msg}`);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
