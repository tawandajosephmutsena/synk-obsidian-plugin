import { App, Modal, Notice, Setting } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { RagCitation, RagGraphNode, RagQueryResponse } from './types';

export class VaultCopilotModal extends Modal {
  private apiClient: SynkkApiClient;
  private vaultSlug: string;
  private queryInput: HTMLTextAreaElement | null = null;
  private responseContainer: HTMLDivElement | null = null;
  private isThinking: boolean = false;

  constructor(app: App, apiClient: SynkkApiClient, vaultSlug: string) {
    super(app);
    this.apiClient = apiClient;
    this.vaultSlug = vaultSlug;
  }

  public onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('synkk-copilot-modal');

    // Modal Header
    contentEl.createEl('h2', {
      text: '✨ Synkk Vault Copilot',
      cls: 'synkk-copilot-title',
    });

    const sub = contentEl.createEl('p', {
      text: 'Private Local RAG · Graph Backlink Traversal · Zero Cloud Leakage',
      cls: 'synkk-copilot-sub',
    });
    sub.style.fontSize = '12px';
    sub.style.color = 'var(--text-muted)';
    sub.style.marginBottom = '16px';

    // Input area
    const inputWrapper = contentEl.createDiv({ cls: 'synkk-copilot-input-wrapper' });
    this.queryInput = inputWrapper.createEl('textarea', {
      placeholder: 'Ask anything about your vault notes (e.g. Summarize architecture)...',
      cls: 'synkk-copilot-input',
    });
    this.queryInput.style.width = '100%';
    this.queryInput.style.height = '68px';
    this.queryInput.style.padding = '8px';
    this.queryInput.style.borderRadius = '6px';
    this.queryInput.style.marginBottom = '10px';

    this.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitQuery();
      }
    });

    const buttonRow = contentEl.createDiv({ cls: 'synkk-copilot-buttons' });
    buttonRow.style.display = 'flex';
    buttonRow.style.justifyContent = 'space-between';
    buttonRow.style.alignItems = 'center';
    buttonRow.style.marginBottom = '16px';

    const chipsDiv = buttonRow.createDiv();
    const quickChip = chipsDiv.createEl('button', {
      text: '⚡ Sync Protocol',
      cls: 'mod-muted',
    });
    quickChip.style.fontSize = '11px';
    quickChip.style.marginRight = '6px';
    quickChip.onclick = () => {
      if (this.queryInput) {
        this.queryInput.value = "Summarize our team's sync protocol and security boundaries";
        this.submitQuery();
      }
    };

    const askButton = buttonRow.createEl('button', {
      text: 'Ask Copilot',
      cls: 'mod-cta',
    });
    askButton.onclick = () => this.submitQuery();

    // Results container
    this.responseContainer = contentEl.createDiv({ cls: 'synkk-copilot-response' });
    this.responseContainer.style.minHeight = '100px';
    this.responseContainer.style.maxHeight = '420px';
    this.responseContainer.style.overflowY = 'auto';
    this.responseContainer.style.borderTop = '1px solid var(--background-modifier-border)';
    this.responseContainer.style.paddingTop = '12px';

    this.renderInitialState();
    this.queryInput.focus();
  }

  private renderInitialState(): void {
    if (!this.responseContainer) return;
    this.responseContainer.empty();
    const p = this.responseContainer.createEl('p', {
      text: 'Ready to query. Enter a question to retrieve relevant chunks and connected wikilinks.',
    });
    p.style.fontSize = '12px';
    p.style.color = 'var(--text-muted)';
  }

  private async submitQuery(): Promise<void> {
    if (this.isThinking || !this.queryInput || !this.responseContainer) return;
    const q = this.queryInput.value.trim();
    if (!q) return;

    this.isThinking = true;
    this.responseContainer.empty();

    const loadingDiv = this.responseContainer.createDiv();
    loadingDiv.style.padding = '16px 0';
    loadingDiv.createEl('div', {
      text: '🧠 Traversing [[wikilinks]] and reasoning over note embeddings...',
    });

    try {
      const res: RagQueryResponse = await this.apiClient.ragQuery(this.vaultSlug, q, true, 4);
      this.renderAnswer(res);
    } catch (err: any) {
      this.responseContainer.empty();
      const errDiv = this.responseContainer.createDiv();
      errDiv.style.color = 'var(--text-error)';
      errDiv.createEl('strong', { text: 'Failed to query Vault Copilot: ' });
      errDiv.createEl('p', { text: err.message || 'Unknown error' });
    } finally {
      this.isThinking = false;
    }
  }

  private renderAnswer(res: RagQueryResponse): void {
    if (!this.responseContainer) return;
    this.responseContainer.empty();

    // Model & Timing info
    const metaBar = this.responseContainer.createDiv();
    metaBar.style.display = 'flex';
    metaBar.style.justifyContent = 'space-between';
    metaBar.style.fontSize = '11px';
    metaBar.style.color = 'var(--text-muted)';
    metaBar.style.marginBottom = '8px';

    metaBar.createEl('span', { text: `Model: ${res.model}` });
    metaBar.createEl('span', { text: `${res.duration_ms}ms` });

    // Graph Nodes
    if (res.graph_nodes && res.graph_nodes.length > 0) {
      const graphSection = this.responseContainer.createDiv();
      graphSection.style.background = 'var(--background-secondary)';
      graphSection.style.borderRadius = '6px';
      graphSection.style.padding = '8px 10px';
      graphSection.style.marginBottom = '12px';

      const label = graphSection.createEl('div', {
        text: '🕸️ Retrieved via [[wikilink]] graph traversal:',
      });
      label.style.fontSize = '11px';
      label.style.fontWeight = 'bold';
      label.style.color = 'var(--text-muted)';
      label.style.marginBottom = '6px';

      const pillsDiv = graphSection.createDiv();
      pillsDiv.style.display = 'flex';
      pillsDiv.style.flexWrap = 'wrap';
      pillsDiv.style.gap = '6px';

      for (const node of res.graph_nodes) {
        const pill = pillsDiv.createEl('button', {
          text: `[[${node.title}]] (${node.relationship})`,
        });
        pill.style.fontSize = '11px';
        pill.style.padding = '2px 8px';
        pill.onclick = () => {
          this.app.workspace.openLinkText(node.path, '', false);
          new Notice(`Opened [[${node.title}]]`);
        };
      }
    }

    // Main Answer
    const answerDiv = this.responseContainer.createDiv({ cls: 'synkk-copilot-answer' });
    answerDiv.style.fontSize = '13px';
    answerDiv.style.lineHeight = '1.6';
    answerDiv.style.marginBottom = '16px';
    answerDiv.innerText = res.answer;

    // Citations
    if (res.citations && res.citations.length > 0) {
      const citSection = this.responseContainer.createDiv();
      citSection.style.borderTop = '1px solid var(--background-modifier-border)';
      citSection.style.paddingTop = '10px';

      const citHeader = citSection.createEl('div', { text: 'Verified Citations:' });
      citHeader.style.fontSize = '11px';
      citHeader.style.fontWeight = 'bold';
      citHeader.style.textTransform = 'uppercase';
      citHeader.style.color = 'var(--text-muted)';
      citHeader.style.marginBottom = '8px';

      for (const cit of res.citations) {
        const citCard = citSection.createDiv();
        citCard.style.background = 'var(--background-secondary)';
        citCard.style.border = '1px solid var(--background-modifier-border)';
        citCard.style.borderRadius = '6px';
        citCard.style.padding = '8px';
        citCard.style.marginBottom = '6px';
        citCard.style.cursor = 'pointer';

        const titleRow = citCard.createDiv();
        titleRow.style.display = 'flex';
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.fontWeight = 'bold';
        titleRow.style.fontSize = '12px';

        titleRow.createEl('span', {
          text: `${cit.note}${cit.heading ? ' #' + cit.heading : ''}`,
        });
        titleRow.createEl('span', {
          text: `${cit.score_pct}%`,
        }).style.color = 'var(--text-accent)';

        const excerptEl = citCard.createEl('div', {
          text: `"${cit.excerpt}"`,
        });
        excerptEl.style.fontSize = '11px';
        excerptEl.style.color = 'var(--text-muted)';
        excerptEl.style.fontStyle = 'italic';
        excerptEl.style.marginTop = '4px';

        citCard.onclick = () => {
          this.app.workspace.openLinkText(cit.note, '', false);
          new Notice(`Opened citation: ${cit.note}`);
        };
      }
    }
  }

  public onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
