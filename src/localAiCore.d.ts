export interface LocalAiDocumentInput {
  path: string;
  title?: string;
  content: string;
  outgoingLinks?: string[];
}

export interface LocalAiRankedDocument {
  path: string;
  title: string;
  content: string;
  outgoingLinks: string[];
  score: number;
  viaGraph?: boolean;
}

export interface LocalAiContextDocument {
  path: string;
  excerpt: string;
  viaGraph?: boolean;
}

export interface LocalAiChatMessage {
  /** Typically 'system' | 'user' | 'assistant' */
  role: string;
  content: string;
}

export function tokenizeText(text: string): string[];

export function rankDocumentsBm25(
  query: string,
  docs: LocalAiDocumentInput[],
  options?: { topK?: number; k1?: number; b?: number }
): LocalAiRankedDocument[];

export function expandGraphNeighbors(
  seedDocs: LocalAiRankedDocument[],
  allDocsMap: Map<string, LocalAiDocumentInput> | Record<string, LocalAiDocumentInput>,
  resolvedLinks?: Record<string, Record<string, number>>,
  options?: { maxNeighbors?: number }
): {
  seedDocs: LocalAiRankedDocument[];
  neighborDocs: LocalAiRankedDocument[];
  combinedDocs: LocalAiRankedDocument[];
};

export function extractRelevantExcerpt(
  content: string,
  queryTokens: string[],
  maxChars?: number
): string;

export function buildLocalChatMessages(
  query: string,
  contextDocs: LocalAiContextDocument[],
  history?: Array<{ role: string; content: string }>,
  activeNotePath?: string | null
): LocalAiChatMessage[];

export function buildLocalSmartMergeMessages(params: {
  conflictPath: string;
  canonicalPath?: string;
  canonicalText: string;
  conflictText: string;
  instructions?: string;
}): LocalAiChatMessage[];

export function normalizeEchoPrivateChannel(channelName: string): string;

export function formatProposalsBadgeText(count: number): string;

export function buildApiUrl(serverUrl: string, endpointPath: string): string;

export function extractCitationPath(citation: {
  note?: string;
  file_path?: string;
  path?: string;
} | null | undefined): string;

export function formatCitationLabel(citation: {
  note?: string;
  file_path?: string;
  path?: string;
  heading?: string | null;
} | null | undefined): string;

export function buildCitationOpenTarget(citation: {
  note?: string;
  file_path?: string;
  path?: string;
  heading?: string | null;
} | null | undefined): string;

export function extractProposalTargetPath(proposal: {
  target_path?: string;
  file_path?: string;
} | null | undefined): string;

export function extractProposalInitialContent(proposal: {
  proposed_content?: string | null;
  preview?: {
    is_stale?: boolean;
    proposed_content?: string;
    diff?: { merged_content?: string };
  } | null;
} | null | undefined): string;

export interface DiffDisplayLine {
  type: 'add' | 'remove' | 'context' | 'conflict';
  content: string;
}

export function buildProposalDiffLines(
  proposal: Record<string, unknown> | null | undefined,
  maxLines?: number
): DiffDisplayLine[];

export function parseSmartMergeOutput(raw: string): {
  mergedContent: string;
  summary: string;
};
