import {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import { AiProposalsModal } from './aiProposalsModal';
import {
  buildCitationOpenTarget,
  extractCitationPath,
  formatCitationLabel,
  normalizeEchoPrivateChannel,
} from './localAiCore.js';
import { LocalAiEngine } from './localAiEngine';
import type SynkkPlugin from './main';
import { AiMessageCitation, AiMessageItem, AiThreadItem } from './types';

export const SYNKK_AI_VIEW_TYPE = 'synkk-ai-sidebar';

interface AiChunkPayload {
  vault_id?: number;
  thread_id?: number;
  run_id?: string;
  delta?: string;
  status_note?: string | null;
}

interface AiCompletedPayload {
  vault_id?: number;
  thread_id?: number;
  run_id?: string;
  status?: string;
  message_id?: number | null;
  content?: string | null;
  citations?: AiMessageCitation[] | null;
  proposal_ids?: number[] | null;
  error_message?: string | null;
}

export class SynkkAiSidebarView extends ItemView {
  private threads: AiThreadItem[] = [];
  private activeThreadId: number | null = null;
  private messages: AiMessageItem[] = [];
  private localMessages: AiMessageItem[] = [];
  private includeActiveNote = true;
  private isSending = false;
  private renderEpoch = 0;

  private activeEchoChannel: string | null = null;
  private activePollIntervalId: number | null = null;
  private activeRunId: string | null = null;

  private rootEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private statusBannerEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private composerInputEl!: HTMLTextAreaElement;
  private sendBtnEl!: HTMLButtonElement;
  private activeNoteLabelEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: SynkkPlugin
  ) {
    super(leaf);
  }

  public getViewType(): string {
    return SYNKK_AI_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return 'Synkk AI';
  }

  public getIcon(): string {
    return 'sparkles';
  }

  public async onOpen(): Promise<void> {
    this.buildSkeleton();
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateActiveNoteLabel();
      })
    );
    await this.refreshState();
  }

  public async onClose(): Promise<void> {
    this.cleanupActiveStream();
  }

  public async refreshState(): Promise<void> {
    if (!this.rootEl) {
      return;
    }

    this.renderToolbar();
    this.updateActiveNoteLabel();

    if (!this.plugin.settings.ragEnabled) {
      this.setStatusBanner(
        'AI features are disabled in Synkk settings.',
        'is-warning'
      );
      this.messagesEl.empty();
      const emptyBox = this.messagesEl.createDiv({ cls: 'synkk-ai-empty' });
      emptyBox.createEl('p', {
        text: 'Enable Vault Copilot & AI in Settings → Synkk Sync to chat with your notes.',
      });
      const openSettingsBtn = emptyBox.createEl('button', {
        text: 'Open Synkk Settings',
        cls: 'mod-cta',
      });
      openSettingsBtn.onclick = () => {
        const appWithSetting = this.app as unknown as {
          setting?: { open?: () => void; openTabById?: (id: string) => void };
        };
        appWithSetting.setting?.open?.();
        appWithSetting.setting?.openTabById?.(this.plugin.manifest.id);
      };
      this.setComposerEnabled(false);
      return;
    }

    if (this.plugin.settings.e2eeEnabled) {
      this.setStatusBanner(
        `🔒 Zero-Knowledge E2EE Local AI (${this.plugin.settings.localAiProvider}: ${this.plugin.settings.localAiModel || 'llama3.2'}). Plaintext never leaves your device.`,
        'is-e2ee'
      );
      this.setComposerEnabled(true);
      await this.renderMessages(this.localMessages);
      return;
    }

    if (!this.plugin.settings.selectedVaultSlug || !this.plugin.settings.deviceToken) {
      this.setStatusBanner(
        'Select a linked vault and pair this device in Synkk settings to use Vault AI.',
        'is-warning'
      );
      this.messagesEl.empty();
      this.setComposerEnabled(false);
      return;
    }

    this.setStatusBanner(
      `☁️ Connected to "${this.plugin.settings.selectedVaultSlug}"`,
      'is-server'
    );
    this.setComposerEnabled(true);
    await this.loadThreads();
  }

  private buildSkeleton(): void {
    const container = this.containerEl.children[1] as HTMLElement | undefined;
    const host = container ?? this.contentEl;
    host.empty();
    host.addClass('synkk-ai-sidebar');
    this.rootEl = host;

    this.toolbarEl = host.createDiv({ cls: 'synkk-ai-toolbar' });
    this.statusBannerEl = host.createDiv({ cls: 'synkk-ai-banner' });
    this.messagesEl = host.createDiv({ cls: 'synkk-ai-messages' });

    const composerEl = host.createDiv({ cls: 'synkk-ai-composer' });

    const contextBar = composerEl.createDiv({ cls: 'synkk-ai-context-bar' });
    const toggleLabel = contextBar.createEl('label', { cls: 'synkk-ai-context-toggle' });
    const checkbox = toggleLabel.createEl('input', { type: 'checkbox' });
    checkbox.checked = this.includeActiveNote;
    checkbox.onchange = () => {
      this.includeActiveNote = checkbox.checked;
      this.updateActiveNoteLabel();
    };
    toggleLabel.createSpan({ text: 'Include active note' });
    this.activeNoteLabelEl = contextBar.createSpan({ cls: 'synkk-ai-active-note' });

    const inputRow = composerEl.createDiv({ cls: 'synkk-ai-input-row' });
    this.composerInputEl = inputRow.createEl('textarea', {
      cls: 'synkk-ai-input',
      attr: {
        rows: '3',
        placeholder: 'Ask about your vault notes (Enter to send, Shift+Enter for newline)...',
      },
    });
    this.composerInputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key === 'Enter' && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        void this.handleSend();
      }
    });

    this.sendBtnEl = inputRow.createEl('button', {
      text: 'Send',
      cls: 'mod-cta synkk-ai-send-btn',
    });
    this.sendBtnEl.onclick = () => {
      void this.handleSend();
    };
  }

  private renderToolbar(): void {
    this.toolbarEl.empty();

    const titleGroup = this.toolbarEl.createDiv({ cls: 'synkk-ai-title-group' });
    titleGroup.createEl('span', {
      text: 'Synkk AI',
      cls: 'synkk-ai-title',
    });

    const isE2ee = this.plugin.settings.e2eeEnabled;
    titleGroup.createSpan({
      text: isE2ee ? 'E2EE Local' : 'Cloud Copilot',
      cls: `synkk-ai-mode-pill ${isE2ee ? 'is-e2ee' : 'is-cloud'}`,
    });

    const controlsRow = this.toolbarEl.createDiv({ cls: 'synkk-ai-controls' });

    if (isE2ee) {
      const clearBtn = controlsRow.createEl('button', {
        text: 'New Chat',
        cls: 'synkk-ai-btn',
      });
      clearBtn.onclick = () => {
        this.localMessages = [];
        void this.renderMessages([]);
      };
      return;
    }

    const threadSelect = controlsRow.createEl('select', { cls: 'synkk-ai-thread-select' });
    if (this.threads.length === 0) {
      threadSelect.createEl('option', { text: 'New conversation', value: '' });
    } else {
      for (const thread of this.threads) {
        const opt = threadSelect.createEl('option', {
          text: thread.title || `Thread #${thread.id}`,
          value: String(thread.id),
        });
        if (thread.id === this.activeThreadId) {
          opt.selected = true;
        }
      }
    }
    threadSelect.onchange = async () => {
      const selected = Number(threadSelect.value);
      if (Number.isFinite(selected) && selected > 0) {
        this.cleanupActiveStream();
        this.activeThreadId = selected;
        await this.loadThreadMessages(selected);
      }
    };

    const newThreadBtn = controlsRow.createEl('button', {
      text: '+ New',
      cls: 'synkk-ai-btn',
      attr: { title: 'Start a new AI thread' },
    });
    newThreadBtn.onclick = async () => {
      await this.createAndSelectThread();
    };

    const inboxBtn = controlsRow.createEl('button', {
      text: 'Inbox',
      cls: 'synkk-ai-btn',
      attr: { title: 'Review pending AI change proposals' },
    });
    inboxBtn.onclick = () => {
      new AiProposalsModal(this.app, this.plugin).open();
    };

    const gardenerBtn = controlsRow.createEl('button', {
      text: 'Gardener',
      cls: 'synkk-ai-btn',
      attr: { title: 'Run Vault Gardener background check now' },
    });
    gardenerBtn.onclick = async () => {
      const slug = this.plugin.settings.selectedVaultSlug;
      if (!slug) {
        new Notice('Synkk: Select a target vault first.');
        return;
      }
      gardenerBtn.disabled = true;
      gardenerBtn.setText('Scanning...');
      try {
        const res = await this.plugin.apiClient.runGardener(slug);
        const scanned = res.files_scanned ?? 1;
        new Notice(
          `Synkk Gardener scanned ${scanned} note(s): ${res.proposals_created} proposal(s), ${res.direct_updates ?? 0} direct update(s), ${res.drift_alerts ?? 0} drift alert(s).`,
          5000
        );
        await this.plugin.refreshProposalsBadge();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Synkk Gardener error: ${msg}`);
      } finally {
        gardenerBtn.disabled = false;
        gardenerBtn.setText('Gardener');
      }
    };
  }

  private setStatusBanner(text: string, variantClass: string): void {
    this.statusBannerEl.className = `synkk-ai-banner ${variantClass}`;
    this.statusBannerEl.setText(text);
  }

  private setComposerEnabled(enabled: boolean): void {
    this.composerInputEl.disabled = !enabled || this.isSending;
    this.sendBtnEl.disabled = !enabled || this.isSending;
  }

  private updateActiveNoteLabel(): void {
    if (!this.activeNoteLabelEl) {
      return;
    }
    if (!this.includeActiveNote) {
      this.activeNoteLabelEl.setText('');
      return;
    }
    const active = this.app.workspace.getActiveFile();
    this.activeNoteLabelEl.setText(active ? active.basename : 'No note open');
  }

  private async loadThreads(): Promise<void> {
    const slug = this.plugin.settings.selectedVaultSlug;
    if (!slug) {
      return;
    }
    try {
      const res = await this.plugin.apiClient.listAiThreads(slug);
      this.threads = res.threads ?? [];
      if (this.threads.length > 0) {
        const stillExists = this.threads.some((t) => t.id === this.activeThreadId);
        if (!stillExists) {
          this.activeThreadId = this.threads[0].id;
        }
        this.renderToolbar();
        if (this.activeThreadId !== null) {
          await this.loadThreadMessages(this.activeThreadId);
        }
      } else {
        this.activeThreadId = null;
        this.messages = [];
        this.renderToolbar();
        await this.renderMessages([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatusBanner(`Failed to load threads: ${msg}`, 'is-error');
    }
  }

  private async createAndSelectThread(title?: string): Promise<number | null> {
    const slug = this.plugin.settings.selectedVaultSlug;
    if (!slug) {
      return null;
    }
    try {
      this.cleanupActiveStream();
      const res = await this.plugin.apiClient.createAiThread(slug, title ? { title } : {});
      this.threads.unshift(res.thread);
      this.activeThreadId = res.thread.id;
      this.messages = [];
      this.renderToolbar();
      await this.renderMessages([]);
      return res.thread.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Synkk AI: Could not create thread (${msg}).`);
      return null;
    }
  }

  private async loadThreadMessages(threadId: number): Promise<void> {
    const slug = this.plugin.settings.selectedVaultSlug;
    if (!slug) {
      return;
    }
    try {
      const res = await this.plugin.apiClient.getAiThreadMessages(slug, threadId);
      this.messages = res.messages ?? [];
      await this.renderMessages(this.messages);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatusBanner(`Failed to load messages: ${msg}`, 'is-error');
    }
  }

  private async renderMessages(list: AiMessageItem[]): Promise<void> {
    const epoch = ++this.renderEpoch;
    this.messagesEl.empty();

    if (list.length === 0) {
      const empty = this.messagesEl.createDiv({ cls: 'synkk-ai-empty' });
      empty.createEl('h4', { text: 'Ask your vault anything' });
      empty.createEl('p', {
        text: this.plugin.settings.e2eeEnabled
          ? 'E2EE Local AI indexes Markdown notes & [[wikilinks]] directly in memory and queries your local model.'
          : 'Vault Copilot combines hybrid semantic + BM25 search, 1-hop graph links, and proposes safe note edits.',
      });
      return;
    }

    for (const msg of list) {
      if (epoch !== this.renderEpoch) {
        return;
      }
      await this.appendMessageElement(msg, epoch);
    }

    if (epoch === this.renderEpoch) {
      this.scrollToBottom();
    }
  }

  private async appendMessageElement(msg: AiMessageItem, expectedEpoch?: number): Promise<HTMLElement> {
    const roleClass = msg.role === 'user' ? 'is-user' : 'is-assistant';
    const card = this.messagesEl.createDiv({ cls: `synkk-ai-msg ${roleClass}` });
    card.createDiv({
      text: msg.role === 'user' ? 'You' : 'Synkk AI',
      cls: 'synkk-ai-msg-role',
    });

    const bodyEl = card.createDiv({ cls: 'synkk-ai-msg-body markdown-rendered' });
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
    if (msg.role === 'user') {
      bodyEl.setText(msg.content);
    } else {
      await MarkdownRenderer.render(this.app, msg.content, bodyEl, sourcePath, this);
    }

    if (expectedEpoch !== undefined && expectedEpoch !== this.renderEpoch) {
      card.remove();
      return card;
    }

    if (msg.role !== 'user') {
      this.renderMessageExtras(card, msg);
    }

    this.scrollToBottom();
    return card;
  }

  private renderMessageExtras(card: HTMLElement, msg: AiMessageItem): void {
    if (msg.citations && msg.citations.length > 0) {
      const citationsWrap = card.createDiv({ cls: 'synkk-ai-citations' });
      citationsWrap.createSpan({ text: 'Sources:', cls: 'synkk-ai-citations-label' });
      const seen = new Set<string>();
      for (const cite of msg.citations) {
        const path = extractCitationPath(cite);
        const openTarget = buildCitationOpenTarget(cite);
        if (!path || seen.has(openTarget)) {
          continue;
        }
        seen.add(openTarget);
        const label = formatCitationLabel(cite) || path;
        const chip = citationsWrap.createEl('button', {
          text: `[[${label}]]`,
          cls: 'synkk-ai-citation-chip',
          attr: { title: cite.excerpt ? `${openTarget}\n${cite.excerpt}` : openTarget },
        });
        chip.onclick = () => {
          void this.app.workspace.openLinkText(openTarget, '', false);
        };
      }
    }

    if (!this.plugin.settings.e2eeEnabled && msg.proposal_ids && msg.proposal_ids.length > 0) {
      const proposalRow = card.createDiv({ cls: 'synkk-ai-proposals-link' });
      const proposalBtn = proposalRow.createEl('button', {
        text: `📋 Review ${msg.proposal_ids.length} proposed edit(s)`,
        cls: 'mod-cta synkk-ai-btn',
      });
      proposalBtn.onclick = () => {
        new AiProposalsModal(this.app, this.plugin).open();
      };
    }

    const actionsEl = card.createDiv({ cls: 'synkk-ai-msg-actions' });

    const copyBtn = actionsEl.createEl('button', { text: 'Copy', cls: 'synkk-ai-action-btn' });
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        new Notice('Copied AI response to clipboard.');
      } catch {
        new Notice('Clipboard copy unavailable.');
      }
    };

    const insertBtn = actionsEl.createEl('button', {
      text: 'Insert at cursor',
      cls: 'synkk-ai-action-btn',
    });
    insertBtn.onclick = () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView?.editor) {
        new Notice('Open a Markdown note editor to insert at cursor.');
        return;
      }
      activeView.editor.replaceSelection(msg.content);
      new Notice(`Inserted response into ${activeView.file?.basename ?? 'note'}.`);
    };

    const saveBtn = actionsEl.createEl('button', {
      text: 'Save as note',
      cls: 'synkk-ai-action-btn',
    });
    saveBtn.onclick = async () => {
      await this.saveResponseAsNote(msg.content);
    };
  }

  private async saveResponseAsNote(content: string): Promise<void> {
    const folder = 'Synkk AI';
    try {
      if (!(await this.app.vault.adapter.exists(folder))) {
        await this.app.vault.createFolder(folder);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const path = `${folder}/AI Note ${stamp}.md`;
      const created: TFile = await this.app.vault.create(path, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(created);
      new Notice(`Saved note: ${path}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Failed to save note: ${msg}`);
    }
  }

  private async handleSend(): Promise<void> {
    if (this.isSending || !this.plugin.settings.ragEnabled) {
      return;
    }

    const prompt = this.composerInputEl.value.trim();
    if (!prompt) {
      return;
    }

    this.composerInputEl.value = '';
    this.isSending = true;
    this.setComposerEnabled(false);

    if (this.plugin.settings.e2eeEnabled) {
      await this.handleLocalE2eeSend(prompt);
    } else {
      await this.handleServerSend(prompt);
    }
  }

  private async handleLocalE2eeSend(prompt: string): Promise<void> {
    const activeFile = this.includeActiveNote ? this.app.workspace.getActiveFile() : null;
    const historySnapshot = this.localMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const userMsg: AiMessageItem = {
      id: Date.now(),
      thread_id: 0,
      role: 'user',
      content: prompt,
    };
    this.localMessages.push(userMsg);
    if (this.localMessages.length === 1) {
      this.messagesEl.empty();
    }
    await this.appendMessageElement(userMsg);

    const streamCard = this.messagesEl.createDiv({ cls: 'synkk-ai-msg is-assistant is-streaming' });
    streamCard.createDiv({ text: 'Synkk AI (Local E2EE)', cls: 'synkk-ai-msg-role' });
    const streamStatusEl = streamCard.createDiv({
      text: 'Searching encrypted local vault notes & wikilinks...',
      cls: 'synkk-ai-stream-status',
    });
    this.scrollToBottom();

    try {
      const engine = new LocalAiEngine(this.app, () => this.plugin.settings);
      const result = await engine.askLocal(prompt, historySnapshot, activeFile?.path ?? null);

      streamCard.remove();
      const assistantMsg: AiMessageItem = {
        id: Date.now() + 1,
        thread_id: 0,
        role: 'assistant',
        content: result.content,
        citations: result.citations,
      };
      this.localMessages.push(assistantMsg);
      await this.appendMessageElement(assistantMsg);
    } catch (err: unknown) {
      streamStatusEl.setText(
        `Local AI error: ${err instanceof Error ? err.message : String(err)}`
      );
      streamCard.addClass('is-error');
    } finally {
      this.isSending = false;
      this.setComposerEnabled(true);
      this.composerInputEl.focus();
    }
  }

  private async handleServerSend(prompt: string): Promise<void> {
    const slug = this.plugin.settings.selectedVaultSlug;
    if (!slug) {
      this.isSending = false;
      this.setComposerEnabled(true);
      return;
    }

    let threadId = this.activeThreadId;
    if (!threadId) {
      threadId = await this.createAndSelectThread(prompt.slice(0, 60));
      if (!threadId) {
        this.isSending = false;
        this.setComposerEnabled(true);
        return;
      }
    }

    const userMsg: AiMessageItem = {
      id: Date.now(),
      thread_id: threadId,
      role: 'user',
      content: prompt,
    };
    this.messages.push(userMsg);
    if (this.messages.length === 1) {
      this.messagesEl.empty();
    }
    await this.appendMessageElement(userMsg);

    const streamCard = this.messagesEl.createDiv({ cls: 'synkk-ai-msg is-assistant is-streaming' });
    streamCard.createDiv({ text: 'Synkk AI', cls: 'synkk-ai-msg-role' });
    const streamStatusEl = streamCard.createDiv({
      text: 'Dispatching request...',
      cls: 'synkk-ai-stream-status',
    });
    const streamBodyEl = streamCard.createDiv({ cls: 'synkk-ai-msg-body' });
    this.scrollToBottom();

    const activeFile = this.includeActiveNote ? this.app.workspace.getActiveFile() : null;
    const contextPaths = activeFile ? [activeFile.path] : undefined;

    try {
      const accepted = await this.plugin.apiClient.sendAiMessage(
        slug,
        threadId,
        prompt,
        contextPaths
      );
      await this.streamRunResponse(
        slug,
        threadId,
        accepted.run_id,
        accepted.channel,
        streamCard,
        streamStatusEl,
        streamBodyEl
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      streamStatusEl.setText(`Error: ${msg}`);
      streamCard.addClass('is-error');
      this.isSending = false;
      this.setComposerEnabled(true);
    }
  }

  private async streamRunResponse(
    vaultSlug: string,
    threadId: number,
    runId: string,
    rawChannel: string,
    streamCard: HTMLElement,
    streamStatusEl: HTMLElement,
    streamBodyEl: HTMLElement
  ): Promise<void> {
    this.cleanupActiveStream();
    this.activeRunId = runId;

    let accumulated = '';
    let completed = false;
    let pollInFlight = false;
    let pollCount = 0;

    const finishSuccess = async (finalMsg: AiMessageItem) => {
      if (completed || this.activeRunId !== runId) {
        return;
      }
      completed = true;
      this.cleanupActiveStream();
      streamCard.remove();

      this.messages.push(finalMsg);
      await this.appendMessageElement(finalMsg);

      this.isSending = false;
      this.setComposerEnabled(true);
      this.composerInputEl.focus();

      // Update thread titles/list & proposal count badge in background
      void this.plugin.refreshProposalsBadge();
      void this.refreshThreadTitlesQuietly(vaultSlug);
    };

    const finishError = (message: string) => {
      if (completed || this.activeRunId !== runId) {
        return;
      }
      completed = true;
      this.cleanupActiveStream();
      streamStatusEl.setText(`Failed: ${message}`);
      streamCard.addClass('is-error');
      this.isSending = false;
      this.setComposerEnabled(true);
      this.composerInputEl.focus();
    };

    const channelName = normalizeEchoPrivateChannel(rawChannel);
    if (channelName) {
      try {
        const echo = await this.plugin.echoManager.connect();
        if (echo && !completed) {
          this.activeEchoChannel = channelName;
          const channel = echo.private(channelName);
          channel.listen('.ai.chunk', (payload: AiChunkPayload) => {
            if (completed || (payload.run_id && payload.run_id !== runId)) {
              return;
            }
            if (payload.status_note) {
              streamStatusEl.setText(payload.status_note);
            }
            if (payload.delta) {
              accumulated += payload.delta;
              streamBodyEl.setText(accumulated);
              this.scrollToBottom();
            }
          });
          channel.listen('.ai.completed', (payload: AiCompletedPayload) => {
            if (completed || (payload.run_id && payload.run_id !== runId)) {
              return;
            }
            if (payload.status === 'failed' || payload.status === 'cancelled') {
              finishError(payload.error_message || `Run ${payload.status}`);
              return;
            }
            const finalContent =
              (typeof payload.content === 'string' && payload.content) ||
              accumulated ||
              '(No response content returned)';
            void finishSuccess({
              id: payload.message_id ?? Date.now(),
              thread_id: threadId,
              role: 'assistant',
              content: finalContent,
              citations: payload.citations ?? [],
              proposal_ids: payload.proposal_ids ?? [],
            });
          });
        }
      } catch {
        // Polling fallback handles completion cleanly
      }
    }

    streamStatusEl.setText('Thinking...');

    // 1.2s reliable polling fallback in case Reverb WebSocket drops or is unavailable
    this.activePollIntervalId = window.setInterval(() => {
      if (completed || pollInFlight) {
        return;
      }
      pollCount += 1;
      if (pollCount > 120) {
        finishError('Timed out waiting for AI response.');
        return;
      }

      pollInFlight = true;
      void this.plugin.apiClient
        .getAiRunStatus(vaultSlug, runId)
        .then((res) => {
          if (completed) {
            return;
          }
          const run = res.run;
          if (typeof run.partial_content === 'string' && run.partial_content.length > accumulated.length) {
            accumulated = run.partial_content;
            streamBodyEl.setText(accumulated);
            this.scrollToBottom();
          }
          if (run.status_note && !accumulated) {
            streamStatusEl.setText(run.status_note);
          }
          if (run.status === 'completed') {
            const msg = run.assistant_message ?? {
              id: run.assistant_message_id ?? Date.now(),
              thread_id: threadId,
              role: 'assistant',
              content: run.partial_content || accumulated || '(Completed)',
              citations: [],
            };
            void finishSuccess(msg);
          } else if (run.status === 'failed' || run.status === 'cancelled') {
            finishError(run.error_message || `Run ${run.status}`);
          }
        })
        .catch(() => {
          // Transient poll error; keep retrying until max polls
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, 1200);
  }

  private async refreshThreadTitlesQuietly(vaultSlug: string): Promise<void> {
    try {
      const res = await this.plugin.apiClient.listAiThreads(vaultSlug);
      if (res.threads) {
        this.threads = res.threads;
        this.renderToolbar();
      }
    } catch {
      // Ignore non-fatal UI refresh failures
    }
  }

  private cleanupActiveStream(): void {
    this.activeRunId = null;
    if (this.activePollIntervalId !== null) {
      window.clearInterval(this.activePollIntervalId);
      this.activePollIntervalId = null;
    }
    if (this.activeEchoChannel) {
      const echo = this.plugin.echoManager.getEcho();
      if (echo) {
        try {
          echo.leave(this.activeEchoChannel);
        } catch {
          // Ignore Echo disconnect errors
        }
      }
      this.activeEchoChannel = null;
    }
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
}
