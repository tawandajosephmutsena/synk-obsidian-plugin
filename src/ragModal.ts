import { App, Modal, Notice } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { RagQueryResponse } from './types';

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

    contentEl.createEl('p', {
      text: 'Private Local RAG · Graph Backlink Traversal · Zero Cloud Leakage',
      cls: 'synkk-copilot-sub',
    });

    // Input area
    const inputWrapper = contentEl.createDiv({ cls: 'synkk-copilot-input-wrapper' });
    this.queryInput = inputWrapper.createEl('textarea', {
      placeholder: 'Ask anything about your vault notes (e.g. Summarize architecture)...',
      cls: 'synkk-copilot-input',
    });

    this.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.submitQuery();
      }
    });

    const buttonRow = contentEl.createDiv({ cls: 'synkk-copilot-buttons' });

    const chipsDiv = buttonRow.createDiv();
    const quickChip = chipsDiv.createEl('button', {
      text: '⚡ Sync Protocol',
      cls: 'mod-muted synkk-copilot-chip',
    });
    quickChip.onclick = () => {
      if (this.queryInput) {
        this.queryInput.value = "Summarize our team's sync protocol and security boundaries";
        void this.submitQuery();
      }
    };

    const askButton = buttonRow.createEl('button', {
      text: 'Ask Copilot',
      cls: 'mod-cta',
    });
    askButton.onclick = () => {
      void this.submitQuery();
    };

    // Results container
    this.responseContainer = contentEl.createDiv({ cls: 'synkk-copilot-response' });

    this.renderInitialState();
    this.queryInput.focus();
  }

  private renderInitialState(): void {
    if (!this.responseContainer) return;
    this.responseContainer.empty();
    this.responseContainer.createEl('p', {
      text: 'Ready to query. Enter a question to retrieve relevant chunks and connected wikilinks.',
      cls: 'synkk-copilot-initial-msg',
    });
  }

  private async submitQuery(): Promise<void> {
    if (this.isThinking || !this.queryInput || !this.responseContainer) return;
    const q = this.queryInput.value.trim();
    if (!q) return;

    this.isThinking = true;
    this.responseContainer.empty();

    const loadingDiv = this.responseContainer.createDiv({ cls: 'synkk-copilot-loading' });
    loadingDiv.createEl('div', {
      text: '🧠 Traversing [[wikilinks]] and reasoning over note embeddings...',
    });

    try {
      const res: RagQueryResponse = await this.apiClient.ragQuery(this.vaultSlug, q, true, 4);
      this.renderAnswer(res);
    } catch (err: unknown) {
      this.responseContainer.empty();
      const errDiv = this.responseContainer.createDiv({ cls: 'synkk-copilot-error' });
      errDiv.createEl('strong', { text: 'Failed to query Vault Copilot: ' });
      const errorMessage = err instanceof Error ? err.message : String(err);
      errDiv.createEl('p', { text: errorMessage });
    } finally {
      this.isThinking = false;
    }
  }

  private renderAnswer(res: RagQueryResponse): void {
    if (!this.responseContainer) return;
    this.responseContainer.empty();

    // Model & Timing info
    const metaBar = this.responseContainer.createDiv({ cls: 'synkk-copilot-metabar' });
    metaBar.createEl('span', { text: `Model: ${res.model}` });
    metaBar.createEl('span', { text: `${res.duration_ms}ms` });

    // Graph Nodes
    if (res.graph_nodes && res.graph_nodes.length > 0) {
      const graphSection = this.responseContainer.createDiv({ cls: 'synkk-copilot-graph-section' });
      graphSection.createEl('div', {
        text: '🕸️ Retrieved via [[wikilink]] graph traversal:',
        cls: 'synkk-copilot-graph-label',
      });

      const pillsDiv = graphSection.createDiv({ cls: 'synkk-copilot-pills' });

      for (const node of res.graph_nodes) {
        const pill = pillsDiv.createEl('button', {
          text: `[[${node.title}]] (${node.relationship})`,
          cls: 'synkk-copilot-pill',
        });
        pill.onclick = () => {
          void this.app.workspace.openLinkText(node.path, '', false);
          new Notice(`Opened [[${node.title}]]`);
        };
      }
    }

    // Main Answer
    const answerDiv = this.responseContainer.createDiv({ cls: 'synkk-copilot-answer' });
    answerDiv.setText(res.answer);

    // Citations
    if (res.citations && res.citations.length > 0) {
      const citSection = this.responseContainer.createDiv({ cls: 'synkk-copilot-cit-section' });
      citSection.createEl('div', {
        text: 'Verified Citations:',
        cls: 'synkk-copilot-cit-header',
      });

      for (const cit of res.citations) {
        const citCard = citSection.createDiv({ cls: 'synkk-copilot-cit-card' });

        const titleRow = citCard.createDiv({ cls: 'synkk-copilot-cit-title' });
        titleRow.createEl('span', {
          text: `${cit.note}${cit.heading ? ' #' + cit.heading : ''}`,
        });
        titleRow.createEl('span', {
          text: `${cit.score_pct}%`,
          cls: 'synkk-copilot-cit-score',
        });

        citCard.createEl('div', {
          text: `"${cit.excerpt}"`,
          cls: 'synkk-copilot-cit-excerpt',
        });

        citCard.onclick = () => {
          void this.app.workspace.openLinkText(cit.note, '', false);
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
