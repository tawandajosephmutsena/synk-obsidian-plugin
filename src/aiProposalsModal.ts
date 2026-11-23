import { App, Modal, Notice } from 'obsidian';
import {
  buildProposalDiffLines,
  extractProposalInitialContent,
  extractProposalTargetPath,
} from './localAiCore.js';
import type SynkkPlugin from './main';
import { AiProposalItem } from './types';

export class AiProposalsModal extends Modal {
  private proposals: AiProposalItem[] = [];
  private statusFilter: 'pending' | 'approved' | 'rejected' | 'superseded' | 'all' = 'pending';
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;

  constructor(
    app: App,
    private plugin: SynkkPlugin
  ) {
    super(app);
  }

  public onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('synkk-proposals-modal');

    const headerRow = contentEl.createDiv({ cls: 'synkk-proposals-header' });
    headerRow.createEl('h2', { text: '✨ Synkk AI Change Inbox' });

    if (this.plugin.settings.e2eeEnabled) {
      const e2eeBox = contentEl.createDiv({ cls: 'synkk-proposals-e2ee-guard' });
      e2eeBox.createEl('h4', { text: '🔒 Disabled in Zero-Knowledge E2EE Mode' });
      e2eeBox.createEl('p', {
        text: 'Agentic Change Proposals and the Vault Gardener run on the Synkk server and cannot read or propose edits to end-to-end encrypted vaults.',
      });
      const closeBtn = contentEl.createEl('button', { text: 'Close', cls: 'mod-cta' });
      closeBtn.onclick = () => this.close();
      return;
    }

    if (!this.plugin.settings.selectedVaultSlug || !this.plugin.settings.deviceToken) {
      contentEl.createEl('p', {
        text: 'Connect and select a synced vault in Synkk settings first.',
      });
      return;
    }

    const toolbar = contentEl.createDiv({ cls: 'synkk-proposals-toolbar' });
    const filterSelect = toolbar.createEl('select', { cls: 'synkk-proposals-filter' });
    const options: Array<{
      label: string;
      value: 'pending' | 'approved' | 'rejected' | 'superseded' | 'all';
    }> = [
      { label: 'Pending Proposals', value: 'pending' },
      { label: 'Approved', value: 'approved' },
      { label: 'Rejected', value: 'rejected' },
      { label: 'Superseded', value: 'superseded' },
      { label: 'All Proposals', value: 'all' },
    ];
    for (const opt of options) {
      const el = filterSelect.createEl('option', { text: opt.label, value: opt.value });
      if (opt.value === this.statusFilter) {
        el.selected = true;
      }
    }
    filterSelect.onchange = async () => {
      this.statusFilter = filterSelect.value as typeof this.statusFilter;
      await this.loadProposals();
    };

    const gardenerBtn = toolbar.createEl('button', {
      text: 'Run Gardener Now',
      cls: 'synkk-ai-btn',
    });
    gardenerBtn.onclick = async () => {
      const slug = this.plugin.settings.selectedVaultSlug;
      if (!slug) {
        return;
      }
      gardenerBtn.disabled = true;
      gardenerBtn.setText('Scanning Vault...');
      try {
        const res = await this.plugin.apiClient.runGardener(slug);
        const scanned = res.files_scanned ?? 1;
        new Notice(
          `Gardener scanned ${scanned} note(s): ${res.proposals_created} proposal(s), ${res.direct_updates ?? 0} direct update(s), ${res.drift_alerts ?? 0} drift alert(s).`,
          5000
        );
        await this.loadProposals();
        await this.plugin.refreshProposalsBadge();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Gardener failed: ${msg}`);
      } finally {
        gardenerBtn.disabled = false;
        gardenerBtn.setText('Run Gardener Now');
      }
    };

    const refreshBtn = toolbar.createEl('button', {
      text: 'Refresh',
      cls: 'synkk-ai-btn',
    });
    refreshBtn.onclick = async () => {
      await this.loadProposals();
    };

    this.statusEl = contentEl.createDiv({ cls: 'synkk-proposals-status' });
    this.listEl = contentEl.createDiv({ cls: 'synkk-proposals-list' });

    void this.loadProposals();
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private async loadProposals(): Promise<void> {
    const slug = this.plugin.settings.selectedVaultSlug;
    if (!slug) {
      return;
    }

    this.statusEl.setText('Loading proposals...');
    this.listEl.empty();

    try {
      const res = await this.plugin.apiClient.listAiProposals(slug, this.statusFilter, true);
      this.proposals = res.proposals ?? [];
      this.renderList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.statusEl.setText(`Failed to load proposals: ${msg}`);
    }
  }

  private renderList(): void {
    this.listEl.empty();

    if (this.proposals.length === 0) {
      this.statusEl.setText(`No ${this.statusFilter} proposals.`);
      return;
    }

    this.statusEl.setText(`Showing ${this.proposals.length} proposal(s).`);

    for (const proposal of this.proposals) {
      this.renderProposalCard(proposal);
    }
  }

  private renderProposalCard(proposal: AiProposalItem): void {
    const card = this.listEl.createDiv({ cls: 'synkk-proposal-card' });
    const targetPath = extractProposalTargetPath(proposal);

    const topRow = card.createDiv({ cls: 'synkk-proposal-card-header' });
    const titleWrap = topRow.createDiv({ cls: 'synkk-proposal-title-wrap' });
    titleWrap.createSpan({
      text: (proposal.action || 'update').toUpperCase(),
      cls: `synkk-proposal-action-badge is-${proposal.action}`,
    });
    if (proposal.source) {
      titleWrap.createSpan({
        text: proposal.source.toUpperCase(),
        cls: 'synkk-proposal-source-badge',
      });
    }
    const titleEl = titleWrap.createEl('strong', {
      text: proposal.title || targetPath,
      cls: 'synkk-proposal-title',
    });
    if (proposal.action === 'move' && proposal.destination_path) {
      titleEl.createSpan({
        text: ` → ${proposal.destination_path}`,
        cls: 'synkk-proposal-move-dest',
      });
    }

    const isStale = Boolean(
      proposal.preview?.is_stale ?? proposal.is_stale ?? proposal.diff_preview?.is_stale
    );
    const hasConflicts = Boolean(proposal.preview?.diff?.has_conflicts);
    const badgeCol = topRow.createDiv({ cls: 'synkk-proposal-status-wrap' });
    if (isStale) {
      badgeCol.createSpan({
        text: hasConflicts ? '⚠️ Stale + Conflicts' : '⚠️ Stale (auto-merged)',
        cls: 'synkk-proposal-stale-badge',
      });
    }
    badgeCol.createSpan({
      text: proposal.status,
      cls: 'synkk-proposal-status-badge',
    });

    card.createDiv({
      text:
        proposal.action === 'move' && proposal.destination_path
          ? `Target: ${targetPath} → ${proposal.destination_path}`
          : `Target: ${targetPath}`,
      cls: 'synkk-proposal-path',
    });

    const rationale = proposal.rationale || proposal.summary;
    if (rationale) {
      card.createDiv({
        text: rationale,
        cls: 'synkk-proposal-rationale',
      });
    }

    // Diff preview block aligned with Laravel preview.diff.hunks + fallback unified diff
    const diffLines = buildProposalDiffLines(proposal as unknown as Record<string, unknown>, 120);
    const unifiedDiff = proposal.diff_preview?.unified_diff;
    if (diffLines.length > 0) {
      const diffEl = card.createDiv({ cls: 'synkk-proposal-diff' });
      for (const line of diffLines) {
        const prefix =
          line.type === 'add'
            ? '+ '
            : line.type === 'remove'
              ? '- '
              : line.type === 'conflict'
                ? ''
                : '  ';
        diffEl.createDiv({
          text: `${prefix}${line.content}`,
          cls: `synkk-diff-line is-${line.type}`,
        });
      }
    } else if (unifiedDiff) {
      const pre = card.createEl('pre', { cls: 'synkk-proposal-diff-pre' });
      pre.setText(unifiedDiff);
    }

    const initialProposed = extractProposalInitialContent(proposal);
    let overrideText = initialProposed;
    let edited = false;

    if (proposal.status === 'pending' && proposal.action !== 'delete') {
      const editorDetails = card.createEl('details', { cls: 'synkk-proposal-editor-details' });
      editorDetails.createEl('summary', { text: 'Edit proposed note content before approving' });
      const textArea = editorDetails.createEl('textarea', {
        cls: 'synkk-proposal-override-input',
      });
      textArea.value = initialProposed;
      textArea.oninput = () => {
        overrideText = textArea.value;
        edited = overrideText !== initialProposed;
      };
    }

    if (proposal.status === 'pending') {
      const actionsRow = card.createDiv({ cls: 'synkk-proposal-actions' });
      const approveBtn = actionsRow.createEl('button', {
        text: 'Approve & Sync',
        cls: 'mod-cta',
      });
      const rejectBtn = actionsRow.createEl('button', {
        text: 'Reject',
      });

      approveBtn.onclick = async () => {
        const slug = this.plugin.settings.selectedVaultSlug;
        if (!slug) {
          return;
        }
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        approveBtn.setText('Applying...');
        try {
          await this.plugin.apiClient.approveAiProposal(
            slug,
            proposal.id,
            edited ? overrideText : undefined
          );
          new Notice(`Approved edit to ${targetPath}. Syncing...`);
          await this.loadProposals();
          await this.plugin.refreshProposalsBadge();
          void this.plugin.syncEngine.sync();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Approval failed: ${msg}`);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          approveBtn.setText('Approve & Sync');
        }
      };

      rejectBtn.onclick = async () => {
        const slug = this.plugin.settings.selectedVaultSlug;
        if (!slug) {
          return;
        }
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        rejectBtn.setText('Rejecting...');
        try {
          await this.plugin.apiClient.rejectAiProposal(slug, proposal.id);
          new Notice(`Rejected proposal for ${targetPath}.`);
          await this.loadProposals();
          await this.plugin.refreshProposalsBadge();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Rejection failed: ${msg}`);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          rejectBtn.setText('Reject');
        }
      };
    }
  }
}
