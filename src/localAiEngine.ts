import { App, requestUrl, TFile } from 'obsidian';
import {
  buildLocalChatMessages,
  buildLocalSmartMergeMessages,
  expandGraphNeighbors,
  extractRelevantExcerpt,
  LocalAiChatMessage,
  LocalAiContextDocument,
  parseSmartMergeOutput,
  rankDocumentsBm25,
  tokenizeText,
} from './localAiCore.js';
import { AiMessageCitation, AiSmartMergeResponse, SynkkSettings } from './types';

export interface LocalAiAskResult {
  content: string;
  citations: AiMessageCitation[];
  provider: string;
  model: string;
  searchedFiles: number;
}

export interface LocalAiConnectionCheck {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  availableModels?: string[];
}

export class LocalAiEngine {
  constructor(
    private app: App,
    private getSettings: () => SynkkSettings
  ) {}

  public async askLocal(
    query: string,
    history: Array<{ role: string; content: string }> = [],
    activeNotePath: string | null = null
  ): Promise<LocalAiAskResult> {
    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .slice()
      .sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
      .slice(0, 500);

    const allDocs: Array<{ path: string; title: string; content: string }> = [];
    const docMap = new Map<string, { path: string; title: string; content: string }>();

    for (const file of markdownFiles) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const entry = { path: file.path, title: file.basename, content };
        allDocs.push(entry);
        docMap.set(file.path, entry);
      } catch {
        // Ignore unreadable transient files
      }
    }

    const queryTokens = tokenizeText(query);
    const seedDocs = rankDocumentsBm25(query, allDocs, { topK: 6 });

    // Ensure active note is represented if query implies current file and nothing ranked higher
    if (activeNotePath && seedDocs.length < 6 && !seedDocs.some((d) => d.path === activeNotePath)) {
      const activeDoc = docMap.get(activeNotePath);
      if (activeDoc) {
        seedDocs.push({
          path: activeDoc.path,
          title: activeDoc.title,
          content: activeDoc.content,
          outgoingLinks: [],
          score: 0.1,
        });
      }
    }

    const resolvedLinks = this.app.metadataCache.resolvedLinks ?? {};
    const expanded = expandGraphNeighbors(seedDocs, docMap, resolvedLinks, { maxNeighbors: 3 });

    const contextDocs: LocalAiContextDocument[] = expanded.combinedDocs.map((doc) => ({
      path: doc.path,
      excerpt: extractRelevantExcerpt(doc.content, queryTokens, 1100),
      viaGraph: doc.viaGraph,
    }));

    const citations: AiMessageCitation[] = expanded.combinedDocs.map((doc) => ({
      note: doc.path,
      file_path: doc.path,
      title: doc.title,
      score: doc.score,
      snippet: extractRelevantExcerpt(doc.content, queryTokens, 200),
    }));

    const messages = buildLocalChatMessages(query, contextDocs, history, activeNotePath);
    const completion = await this.callLocalModel(messages);

    return {
      content: completion.content,
      citations,
      provider: completion.provider,
      model: completion.model,
      searchedFiles: allDocs.length,
    };
  }

  public async smartMergeLocal(params: {
    conflictPath: string;
    canonicalPath?: string;
    canonicalText: string;
    conflictText: string;
    instructions?: string;
  }): Promise<AiSmartMergeResponse> {
    const messages = buildLocalSmartMergeMessages(params);
    const completion = await this.callLocalModel(messages);

    const parsed = parseSmartMergeOutput(completion.content);
    return {
      status: 'ok',
      merged_content: parsed.mergedContent,
      summary: parsed.summary,
      strategy: 'local_e2ee',
      conflict_path: params.conflictPath,
      canonical_path: params.canonicalPath ?? params.conflictPath,
      model: completion.model,
      provider: completion.provider,
    };
  }

  public async testConnection(): Promise<LocalAiConnectionCheck> {
    const config = this.resolveProviderConfig();
    if (!config.baseUrl) {
      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        message: 'Local AI Base URL is empty.',
      };
    }

    try {
      if (config.provider === 'ollama') {
        const res = await requestUrl({
          url: `${config.baseUrl}/api/tags`,
          method: 'GET',
          throw: false,
        });
        if (res.status >= 400) {
          return {
            ok: false,
            provider: config.provider,
            model: config.model,
            message: `Ollama returned HTTP ${res.status}. Verify Ollama is running at ${config.baseUrl}.`,
          };
        }
        const json = (res.json ?? {}) as { models?: Array<{ name?: string }> };
        const models = (json.models ?? [])
          .map((m) => m.name ?? '')
          .filter((name): name is string => Boolean(name));
        const hasModel = models.some(
          (name) => name === config.model || name.startsWith(`${config.model}:`)
        );
        return {
          ok: true,
          provider: config.provider,
          model: config.model,
          availableModels: models,
          message: hasModel
            ? `Connected to Ollama (${models.length} models installed, "${config.model}" ready).`
            : `Connected to Ollama, but "${config.model}" was not found in installed tags (${models.join(', ') || 'none'}).`,
        };
      }

      const endpoint = this.buildOpenAiEndpoint(config.baseUrl, '/models');
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      const res = await requestUrl({
        url: endpoint,
        method: 'GET',
        headers,
        throw: false,
      });
      if (res.status >= 400) {
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          message: `OpenAI-compatible endpoint returned HTTP ${res.status}.`,
        };
      }
      const json = (res.json ?? {}) as { data?: Array<{ id?: string }> };
      const models = (json.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id): id is string => Boolean(id));
      return {
        ok: true,
        provider: config.provider,
        model: config.model,
        availableModels: models,
        message: `Connected to OpenAI-compatible server (${models.length} models reported).`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        message: `Connection failed: ${msg}`,
      };
    }
  }

  private resolveProviderConfig(): {
    provider: 'ollama' | 'openai_compatible';
    baseUrl: string;
    model: string;
    apiKey: string;
  } {
    const settings = this.getSettings();
    const provider = settings.localAiProvider ?? 'ollama';
    const rawBase =
      settings.localAiBaseUrl?.trim() ||
      settings.ragOllamaUrl?.trim() ||
      'http://localhost:11434';
    const baseUrl = rawBase.replace(/\/+$/, '');
    const model =
      settings.localAiModel?.trim() ||
      settings.ragOllamaModel?.trim() ||
      'llama3.2';
    const apiKey = settings.localAiApiKey?.trim() || '';
    return { provider, baseUrl, model, apiKey };
  }

  private buildOpenAiEndpoint(baseUrl: string, suffix: string): string {
    const clean = baseUrl.replace(/\/+$/, '');
    return clean.endsWith('/v1') ? `${clean}${suffix}` : `${clean}/v1${suffix}`;
  }

  private async callLocalModel(
    messages: LocalAiChatMessage[]
  ): Promise<{ content: string; provider: string; model: string }> {
    const config = this.resolveProviderConfig();

    if (config.provider === 'ollama') {
      const res = await requestUrl({
        url: `${config.baseUrl}/api/chat`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
        }),
        throw: false,
      });

      if (res.status >= 400) {
        const errJson = (res.json ?? {}) as { error?: string };
        throw new Error(
          `Local Ollama error (HTTP ${res.status}): ${errJson.error || res.text || 'Request failed'}`
        );
      }

      const json = (res.json ?? {}) as {
        message?: { content?: string };
        response?: string;
      };
      const content = json.message?.content ?? json.response ?? '';
      if (!content.trim()) {
        throw new Error('Local Ollama returned an empty response.');
      }

      return {
        content: content.trim(),
        provider: 'ollama',
        model: config.model,
      };
    }

    const endpoint = this.buildOpenAiEndpoint(config.baseUrl, '/chat/completions');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const res = await requestUrl({
      url: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
      }),
      throw: false,
    });

    if (res.status >= 400) {
      const errJson = (res.json ?? {}) as { error?: { message?: string } | string };
      const errDetail =
        typeof errJson.error === 'string'
          ? errJson.error
          : errJson.error?.message || res.text || 'Request failed';
      throw new Error(`Local OpenAI-compatible error (HTTP ${res.status}): ${errDetail}`);
    }

    const json = (res.json ?? {}) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
      throw new Error('Local AI endpoint returned an empty response.');
    }

    return {
      content: content.trim(),
      provider: 'openai_compatible',
      model: config.model,
    };
  }
}
