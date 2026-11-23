const STOPWORDS = new Set([
  'is', 'in', 'on', 'at', 'to', 'of', 'it', 'or', 'as', 'by', 'be', 'an', 'we', 'do', 'if', 'so', 'no', 'up', 'my',
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has',
  'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'let', 'put', 'say', 'she',
  'too', 'use', 'with', 'that', 'this', 'from', 'they', 'have', 'what', 'when', 'were', 'will', 'more', 'been',
  'than', 'them', 'then', 'some', 'into', 'only', 'over', 'such', 'make', 'like', 'time', 'just', 'know', 'take',
  'year', 'your', 'good', 'could', 'would', 'should', 'about', 'which', 'where', 'there', 'their', 'these', 'those',
]);

/**
 * Tokenize markdown or query text into normalized lowercase search terms.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeText(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu);
  if (!matches) {
    return [];
  }
  const tokens = [];
  for (const raw of matches) {
    const clean = raw.replace(/^[_-]+|[_-]+$/g, '');
    if (clean.length < 2 || STOPWORDS.has(clean)) {
      continue;
    }
    tokens.push(clean);
  }
  return tokens;
}

/**
 * Rank local markdown documents against a natural-language query using BM25 + title boost.
 * @param {string} query
 * @param {Array<{ path: string, title?: string, content: string, outgoingLinks?: string[] }>} docs
 * @param {{ topK?: number, k1?: number, b?: number }} [options]
 */
export function rankDocumentsBm25(query, docs, options = {}) {
  const topK = options.topK ?? 8;
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;

  const queryTokens = Array.from(new Set(tokenizeText(query)));
  if (queryTokens.length === 0 || !Array.isArray(docs) || docs.length === 0) {
    return [];
  }

  const prepared = docs.map((doc) => {
    const title = doc.title ?? deriveTitleFromPath(doc.path);
    const bodyTokens = tokenizeText(doc.content ?? '');
    const titleTokens = new Set(tokenizeText(`${title} ${doc.path ?? ''}`));
    const tf = new Map();
    for (const tok of bodyTokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    return {
      doc,
      title,
      tf,
      titleTokens,
      length: Math.max(bodyTokens.length, 1),
    };
  });

  const N = prepared.length;
  const avgDl = prepared.reduce((sum, item) => sum + item.length, 0) / N;

  const df = new Map();
  for (const qTok of queryTokens) {
    let count = 0;
    for (const item of prepared) {
      if (item.tf.has(qTok) || item.titleTokens.has(qTok)) {
        count += 1;
      }
    }
    df.set(qTok, count);
  }

  const scored = [];
  for (const item of prepared) {
    let score = 0;
    for (const qTok of queryTokens) {
      const termDf = df.get(qTok) ?? 0;
      const idf = Math.log(1 + (N - termDf + 0.5) / (termDf + 0.5));
      const freq = item.tf.get(qTok) ?? 0;
      if (freq > 0) {
        const denom = freq + k1 * (1 - b + (b * item.length) / avgDl);
        score += idf * ((freq * (k1 + 1)) / denom);
      }
      if (item.titleTokens.has(qTok)) {
        score += idf * 2.2;
      }
    }
    if (score > 0) {
      scored.push({
        path: item.doc.path,
        title: item.title,
        content: item.doc.content ?? '',
        outgoingLinks: item.doc.outgoingLinks ?? [],
        score: Number(score.toFixed(4)),
      });
    }
  }

  scored.sort((a, bItem) => bItem.score - a.score || a.path.localeCompare(bItem.path));
  return scored.slice(0, topK);
}

/**
 * Expand BM25 seed documents using 1-hop Obsidian wikilinks (outgoing and incoming backlinks).
 * @param {Array<{ path: string, title?: string, content: string, score: number }>} seedDocs
 * @param {Map<string, { path: string, title?: string, content: string }> | Record<string, { path: string, title?: string, content: string }>} allDocsMap
 * @param {Record<string, Record<string, number>>} resolvedLinks
 * @param {{ maxNeighbors?: number }} [options]
 */
export function expandGraphNeighbors(seedDocs, allDocsMap, resolvedLinks = {}, options = {}) {
  const maxNeighbors = options.maxNeighbors ?? 4;
  if (!Array.isArray(seedDocs) || seedDocs.length === 0) {
    return { seedDocs: [], neighborDocs: [], combinedDocs: [] };
  }

  const seedSet = new Set(seedDocs.map((d) => d.path));
  const neighborScores = new Map();

  const getDoc = (path) => {
    if (allDocsMap instanceof Map) {
      return allDocsMap.get(path) ?? null;
    }
    return allDocsMap && typeof allDocsMap === 'object' ? allDocsMap[path] ?? null : null;
  };

  for (const seed of seedDocs) {
    const outgoing = resolvedLinks?.[seed.path];
    if (outgoing && typeof outgoing === 'object') {
      for (const targetPath of Object.keys(outgoing)) {
        if (seedSet.has(targetPath)) {
          continue;
        }
        const prev = neighborScores.get(targetPath) ?? 0;
        neighborScores.set(targetPath, prev + (seed.score ?? 1) * 0.5);
      }
    }
  }

  if (resolvedLinks && typeof resolvedLinks === 'object') {
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (seedSet.has(sourcePath) || !targets || typeof targets !== 'object') {
        continue;
      }
      for (const seed of seedDocs) {
        if ((targets[seed.path] ?? 0) > 0) {
          const prev = neighborScores.get(sourcePath) ?? 0;
          neighborScores.set(sourcePath, prev + (seed.score ?? 1) * 0.45);
        }
      }
    }
  }

  const neighborDocs = [];
  for (const [path, score] of neighborScores.entries()) {
    const doc = getDoc(path);
    if (!doc) {
      continue;
    }
    neighborDocs.push({
      path: doc.path,
      title: doc.title ?? deriveTitleFromPath(doc.path),
      content: doc.content ?? '',
      score: Number(score.toFixed(4)),
      viaGraph: true,
    });
  }

  neighborDocs.sort((a, bItem) => bItem.score - a.score || a.path.localeCompare(bItem.path));
  const limitedNeighbors = neighborDocs.slice(0, maxNeighbors);

  return {
    seedDocs,
    neighborDocs: limitedNeighbors,
    combinedDocs: [...seedDocs, ...limitedNeighbors],
  };
}

/**
 * Extract the highest-density excerpt matching query tokens from a note's markdown content.
 * @param {string} content
 * @param {string[]} queryTokens
 * @param {number} [maxChars]
 * @returns {string}
 */
export function extractRelevantExcerpt(content, queryTokens, maxChars = 1200) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  const normalized = content.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const tokens = (queryTokens ?? []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (tokens.length === 0) {
    return `${normalized.slice(0, maxChars).trimEnd()}...`;
  }

  const lower = normalized.toLowerCase();
  let bestPos = -1;
  let bestHits = 0;

  const step = Math.max(80, Math.floor(maxChars / 4));
  for (let start = 0; start < lower.length; start += step) {
    const windowText = lower.slice(start, start + maxChars);
    let hits = 0;
    for (const tok of tokens) {
      if (windowText.includes(tok)) {
        hits += 1;
      }
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestPos = start;
    }
  }

  if (bestPos <= 0 || bestHits === 0) {
    return `${normalized.slice(0, maxChars).trimEnd()}...`;
  }

  // Align backward to a newline or word boundary for cleaner markdown snippets
  const adjustedStart = Math.max(0, normalized.lastIndexOf('\n', bestPos) + 1 || bestPos);
  const slice = normalized.slice(adjustedStart, adjustedStart + maxChars).trim();
  const prefix = adjustedStart > 0 ? '...' : '';
  const suffix = adjustedStart + maxChars < normalized.length ? '...' : '';
  return `${prefix}${slice}${suffix}`;
}

/**
 * Build OpenAI/Ollama-compatible chat messages for local E2EE Vault AI Q&A.
 * @param {string} query
 * @param {Array<{ path: string, excerpt: string, viaGraph?: boolean }>} contextDocs
 * @param {Array<{ role: string, content: string }>} [history]
 * @param {string | null} [activeNotePath]
 */
export function buildLocalChatMessages(query, contextDocs, history = [], activeNotePath = null) {
  const systemPrompt = [
    'You are Synkk Local AI running in Zero-Knowledge E2EE mode directly on the user device.',
    'All retrieval and inference stay local; plaintext notes were never uploaded to Synkk servers.',
    'Answer strictly using the retrieved vault excerpts below. Cite supporting notes inline using [[path/to/note.md]] wikilinks.',
    'If the retrieved excerpts do not contain enough information, state clearly what is missing without inventing facts.',
  ].join(' ');

  const messages = [{ role: 'system', content: systemPrompt }];

  if (Array.isArray(history)) {
    const recent = history.slice(-6);
    for (const msg of recent) {
      if (!msg || !msg.content) {
        continue;
      }
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: String(msg.content) });
    }
  }

  const contextBlocks = (contextDocs ?? []).map((doc, idx) => {
    const badge = doc.viaGraph ? ' [1-hop link]' : '';
    return `--- Source ${idx + 1}: ${doc.path}${badge} ---\n${doc.excerpt}`;
  });

  const activeLine = activeNotePath ? `Currently open note: ${activeNotePath}\n\n` : '';
  const userContent =
    contextBlocks.length > 0
      ? `${activeLine}Retrieved vault notes:\n\n${contextBlocks.join('\n\n')}\n\nQuestion: ${query}`
      : `${activeLine}No matching notes were retrieved from the local vault.\n\nQuestion: ${query}`;

  messages.push({ role: 'user', content: userContent });
  return messages;
}

/**
 * Build OpenAI/Ollama-compatible messages for local E2EE Smart Conflict Merge.
 * @param {{ conflictPath: string, canonicalPath?: string, canonicalText: string, conflictText: string, instructions?: string }} params
 */
export function buildLocalSmartMergeMessages(params) {
  const { conflictPath, canonicalPath, canonicalText, conflictText, instructions } = params;
  const systemPrompt = [
    'You are Synkk Smart Merge running locally for an E2EE vault.',
    'Reconcile both Markdown note versions into a single coherent note.',
    'Preserve all unique ideas, checklists, frontmatter properties, headings, and [[wikilinks]] from both versions.',
    'If lines contradict, prefer the canonical version unless custom instructions specify otherwise.',
    'Respond ONLY with a valid JSON object of the form {"merged_content": "...", "summary": "..."}.',
  ].join(' ');

  const parts = [
    `Canonical note (${canonicalPath || conflictPath}):\n\`\`\`markdown\n${canonicalText}\n\`\`\``,
    `Conflict note (${conflictPath}):\n\`\`\`markdown\n${conflictText}\n\`\`\``,
  ];
  if (instructions && instructions.trim()) {
    parts.push(`Custom merge instructions: ${instructions.trim()}`);
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Strip the leading "private-" prefix from a Pusher/Reverb channel name before passing to echo.private().
 * @param {string} channelName
 * @returns {string}
 */
export function normalizeEchoPrivateChannel(channelName) {
  if (!channelName || typeof channelName !== 'string') {
    return '';
  }
  const trimmed = channelName.trim();
  return trimmed.startsWith('private-') ? trimmed.slice('private-'.length) : trimmed;
}

/**
 * Format the status bar pending AI proposals badge text.
 * @param {number} count
 * @returns {string}
 */
export function formatProposalsBadgeText(count) {
  const num = Number.isFinite(count) ? Math.floor(count) : 0;
  if (num <= 0) {
    return '';
  }
  if (num > 99) {
    return '✨ 99+ AI';
  }
  return `✨ ${num} AI`;
}

function deriveTitleFromPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return 'Untitled';
  }
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}

/**
 * Normalize serverUrl + endpoint path without ever duplicating the /api/v1 prefix.
 * @param {string} serverUrl
 * @param {string} endpointPath
 * @returns {string}
 */
export function buildApiUrl(serverUrl, endpointPath) {
  const rawBase = String(serverUrl ?? '').trim().replace(/\/+$/, '');
  const rawPath = String(endpointPath ?? '').trim();
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (!rawBase) {
    return normalizedPath;
  }
  if (/\/api\/v1$/i.test(rawBase)) {
    return `${rawBase}${normalizedPath}`;
  }
  return `${rawBase}/api/v1${normalizedPath}`;
}

/**
 * Resolve note path from either server ("note") or local E2EE ("file_path"/"path") citations.
 * @param {Record<string, any> | null | undefined} citation
 * @returns {string}
 */
export function extractCitationPath(citation) {
  if (!citation || typeof citation !== 'object') {
    return '';
  }
  return String(citation.note || citation.file_path || citation.path || '').trim();
}

/**
 * Format display chip label for a citation (basename + optional #heading).
 * @param {Record<string, any> | null | undefined} citation
 * @returns {string}
 */
export function formatCitationLabel(citation) {
  const path = extractCitationPath(citation);
  if (!path) {
    return '';
  }
  const base = deriveTitleFromPath(path);
  const heading = citation?.heading ? String(citation.heading).trim() : '';
  return heading ? `${base} #${heading}` : base;
}

/**
 * Build Obsidian openLinkText target string (path or path#heading).
 * @param {Record<string, any> | null | undefined} citation
 * @returns {string}
 */
export function buildCitationOpenTarget(citation) {
  const path = extractCitationPath(citation);
  if (!path) {
    return '';
  }
  const heading = citation?.heading ? String(citation.heading).trim() : '';
  return heading ? `${path}#${heading}` : path;
}

/**
 * Resolve target path from Laravel ("target_path") or legacy ("file_path") proposal shapes.
 * @param {Record<string, any> | null | undefined} proposal
 * @returns {string}
 */
export function extractProposalTargetPath(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return '';
  }
  return String(proposal.target_path || proposal.file_path || '').trim();
}

/**
 * Resolve initial editable proposal content (preferring auto-merged content when stale).
 * @param {Record<string, any> | null | undefined} proposal
 * @returns {string}
 */
export function extractProposalInitialContent(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return '';
  }
  if (proposal.preview?.is_stale && typeof proposal.preview?.diff?.merged_content === 'string') {
    return proposal.preview.diff.merged_content;
  }
  if (typeof proposal.preview?.proposed_content === 'string') {
    return proposal.preview.proposed_content;
  }
  return typeof proposal.proposed_content === 'string' ? proposal.proposed_content : '';
}

/**
 * Convert a Laravel AiProposal (with preview.diff.hunks) into renderable colored diff lines.
 * @param {Record<string, any> | null | undefined} proposal
 * @param {number} [maxLines]
 * @returns {Array<{ type: 'add' | 'remove' | 'context' | 'conflict', content: string }>}
 */
export function buildProposalDiffLines(proposal, maxLines = 120) {
  if (!proposal || typeof proposal !== 'object') {
    return [];
  }

  if (Array.isArray(proposal.diff_preview?.diff_lines) && proposal.diff_preview.diff_lines.length > 0) {
    return capDiffLines(proposal.diff_preview.diff_lines, maxLines);
  }

  const currentContent =
    typeof proposal.preview?.current_content === 'string'
      ? proposal.preview.current_content
      : typeof proposal.original_content === 'string'
        ? proposal.original_content
        : '';

  const proposedContent =
    typeof proposal.preview?.proposed_content === 'string'
      ? proposal.preview.proposed_content
      : typeof proposal.proposed_content === 'string'
        ? proposal.proposed_content
        : '';

  const out = [];

  if (proposal.action === 'create' || currentContent === '') {
    if (proposedContent === '') {
      return [];
    }
    for (const line of splitMarkdownLines(proposedContent)) {
      out.push({ type: 'add', content: line });
    }
    return capDiffLines(out, maxLines);
  }

  const hunks = proposal.preview?.diff?.hunks;
  if (Array.isArray(hunks) && hunks.length > 0) {
    for (const hunk of hunks) {
      if (hunk.is_conflict) {
        out.push({ type: 'conflict', content: '@@ Conflict (Current vs Proposed) @@' });
        for (const line of hunk.our_lines ?? []) {
          out.push({ type: 'remove', content: line });
        }
        for (const line of hunk.their_lines ?? []) {
          out.push({ type: 'add', content: line });
        }
        continue;
      }

      const ourLines = Array.isArray(hunk.our_lines) ? hunk.our_lines : [];
      const resolvedLines = Array.isArray(hunk.resolved_lines) ? hunk.resolved_lines : [];

      if (linesEqual(ourLines, resolvedLines)) {
        if (ourLines.length <= 4) {
          for (const line of ourLines) {
            out.push({ type: 'context', content: line });
          }
        } else {
          out.push({ type: 'context', content: ourLines[0] });
          out.push({ type: 'context', content: '...' });
          out.push({ type: 'context', content: ourLines[ourLines.length - 1] });
        }
        continue;
      }

      appendTrimmedLineDiff(out, ourLines, resolvedLines);
    }

    return capDiffLines(out, maxLines);
  }

  appendTrimmedLineDiff(
    out,
    splitMarkdownLines(currentContent),
    splitMarkdownLines(proposedContent)
  );
  return capDiffLines(out, maxLines);
}

/**
 * Parse Smart Merge JSON output (handling fenced code blocks or falling back to raw markdown).
 * @param {string} raw
 * @returns {{ mergedContent: string, summary: string }}
 */
export function parseSmartMergeOutput(raw) {
  const trimmed = String(raw ?? '').trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed.merged_content === 'string' && parsed.merged_content.length > 0) {
        return {
          mergedContent: parsed.merged_content,
          summary:
            typeof parsed.summary === 'string' && parsed.summary.trim()
              ? parsed.summary.trim()
              : 'Reconciled locally via E2EE Local AI.',
        };
      }
    } catch {
      // Fall back to raw text when model omits valid JSON wrapper
    }
  }

  return {
    mergedContent: trimmed,
    summary: 'Reconciled locally via E2EE Local AI (raw markdown output).',
  };
}

function splitMarkdownLines(text) {
  return String(text ?? '').split(/\r\n|\r|\n/);
}

function linesEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function appendTrimmedLineDiff(out, oldLines, newLines) {
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  if (prefix > 0) {
    const startCtx = Math.max(0, prefix - 2);
    for (let i = startCtx; i < prefix; i += 1) {
      out.push({ type: 'context', content: oldLines[i] });
    }
  }

  for (let i = prefix; i < oldLines.length - suffix; i += 1) {
    out.push({ type: 'remove', content: oldLines[i] });
  }
  for (let i = prefix; i < newLines.length - suffix; i += 1) {
    out.push({ type: 'add', content: newLines[i] });
  }

  if (suffix > 0) {
    const tailStart = newLines.length - suffix;
    const tailEnd = Math.min(newLines.length, tailStart + 2);
    for (let i = tailStart; i < tailEnd; i += 1) {
      out.push({ type: 'context', content: newLines[i] });
    }
  }
}

function capDiffLines(lines, maxLines) {
  if (lines.length <= maxLines) {
    return lines;
  }
  const visible = lines.slice(0, Math.max(1, maxLines - 1));
  visible.push({
    type: 'context',
    content: `... (${lines.length - visible.length} more lines truncated)`,
  });
  return visible;
}
