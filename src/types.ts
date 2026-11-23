export interface SynkkSettings {
  serverUrl: string;
  deviceToken: string;
  selectedVaultSlug: string;
  selectedVaultName: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  syncOnStartup: boolean;
  syncOnFileChange: boolean;
  includedPaths: string;
  excludedPaths: string;
  syncPluginSuite: boolean;
  syncPluginList: boolean;
  syncSnippets: boolean;
  syncPluginData: boolean;
  deletionThresholdPercent: number;
  safetyOverrideForNextSync: boolean;
  lastSyncTime: number;
  lastSyncVersion: number;
  userRootPermission: string;
  e2eeEnabled: boolean;
  e2eePassphrase: string;
  e2eeSalt: string;
  ghostFilesEnabled: boolean;
  ghostThresholdMb: number;
  mobileBackgroundRelay: boolean;
  realtimeCollaboration: boolean;
  ragEnabled: boolean;
  ragUseLocalOllama: boolean;
  ragOllamaUrl: string;
  ragOllamaModel: string;
  localAiProvider: 'ollama' | 'openai_compatible';
  localAiBaseUrl: string;
  localAiModel: string;
  localAiApiKey: string;
  aiShowProposalsBadge: boolean;
  broadcasting?: BroadcastingConfig;
}

export interface BroadcastingConfig {
  driver: string;
  key: string;
  host: string;
  port: number;
  scheme: string;
}

export interface TransportStatus {
  status: string;
  vault: string;
  latest_version: number;
  is_e2ee: boolean;
  active_collaborators: number;
  total_files: number;
  server_time: string;
}

export const DEFAULT_SETTINGS: SynkkSettings = {
  serverUrl: 'https://synkk.space/api/v1',
  deviceToken: '',
  selectedVaultSlug: '',
  selectedVaultName: '',
  autoSync: true,
  syncIntervalMinutes: 5,
  syncOnStartup: true,
  syncOnFileChange: true,
  includedPaths: '',
  excludedPaths: '',
  syncPluginSuite: true,
  syncPluginList: false,
  syncSnippets: false,
  syncPluginData: false,
  deletionThresholdPercent: 10,
  safetyOverrideForNextSync: false,
  lastSyncTime: 0,
  lastSyncVersion: 0,
  userRootPermission: 'read_write',
  e2eeEnabled: false,
  e2eePassphrase: '',
  e2eeSalt: '',
  ghostFilesEnabled: true,
  ghostThresholdMb: 5,
  mobileBackgroundRelay: true,
  realtimeCollaboration: false,
  ragEnabled: true,
  ragUseLocalOllama: false,
  ragOllamaUrl: 'http://localhost:11434',
  ragOllamaModel: 'llama3.2',
  localAiProvider: 'ollama',
  localAiBaseUrl: 'http://localhost:11434',
  localAiModel: 'llama3.2',
  localAiApiKey: '',
  aiShowProposalsBadge: true,
};

export interface AiThreadItem {
  id: number;
  vault_id?: number;
  user_id?: number;
  title: string | null;
  is_shared_with_team?: boolean;
  scope?: string;
  last_message_at?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: {
    id: number;
    name: string;
  };
}

export interface AiMessageCitation {
  note?: string;
  file_path?: string;
  path?: string;
  title?: string;
  heading?: string | null;
  start_line?: number;
  score?: number;
  score_pct?: number;
  snippet?: string;
  excerpt?: string;
  chunk_index?: number;
}

export interface AiMessageItem {
  id: number;
  thread_id: number;
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
  citations?: AiMessageCitation[] | null;
  proposal_ids?: number[] | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
}

export interface AiRunItem {
  id: number | string;
  run_id?: string;
  thread_id: number;
  status: 'queued' | 'running' | 'streaming' | 'completed' | 'failed' | 'cancelled' | string;
  partial_content?: string | null;
  status_note?: string | null;
  error_message?: string | null;
  assistant_message_id?: number | null;
  assistant_message?: AiMessageItem | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
}

export interface AiSendMessageResponse {
  status: string;
  run_id: string;
  channel: string;
  run: AiRunItem;
}

export interface AiProposalDiffLine {
  type: 'add' | 'remove' | 'context' | 'conflict' | string;
  content: string;
  old_line?: number | null;
  new_line?: number | null;
}

export interface AiProposalHunk {
  id: number;
  type: string;
  is_conflict: boolean;
  base_lines: string[];
  our_lines: string[];
  their_lines: string[];
  resolved_lines: string[];
  choice: string;
}

export interface AiProposalPreview {
  is_stale: boolean;
  base_version?: number | null;
  current_version?: number | null;
  current_content: string;
  proposed_content: string;
  diff: {
    has_conflicts: boolean;
    conflict_count: number;
    clean_count: number;
    merged_content: string;
    hunks: AiProposalHunk[];
  };
}

export interface AiProposalDiffPreview {
  original_content?: string;
  proposed_content?: string;
  unified_diff?: string;
  diff_lines?: AiProposalDiffLine[];
  additions?: number;
  deletions?: number;
  is_stale?: boolean;
  stale_reason?: string | null;
}

export interface AiProposalItem {
  id: number;
  team_id?: number;
  vault_id?: number;
  vault_file_id?: number | null;
  thread_id?: number | null;
  target_path: string;
  destination_path?: string | null;
  file_path?: string;
  action: 'create' | 'update' | 'append' | 'move' | 'delete' | 'rename' | 'tag' | string;
  title?: string | null;
  rationale?: string | null;
  summary?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'applied' | string;
  base_version?: number | null;
  base_content_hash?: string | null;
  proposed_content?: string | null;
  original_content?: string | null;
  base_file_hash?: string | null;
  current_file_hash?: string | null;
  is_stale?: boolean;
  preview?: AiProposalPreview | null;
  diff_preview?: AiProposalDiffPreview | null;
  source?: string | null;
  created_at?: string;
}

export interface AiSmartMergeResponse {
  status: string;
  merged_content: string;
  summary?: string | null;
  explanation?: string | null;
  strategy?: string | null;
  resolutions?: Array<{
    hunk_id: number;
    strategy: string;
    rationale: string;
  }>;
  conflict_count?: number;
  clean_count?: number;
  used_ai?: boolean;
  had_unmerged_markers?: boolean;
  conflict_path?: string;
  canonical_path?: string;
  model?: string | null;
  provider?: string | null;
}

export interface AiGardenerRunResponse {
  status: string;
  files_scanned?: number;
  proposals_created: number;
  direct_updates?: number;
  drift_alerts?: number;
  proposal_ids?: number[];
  path?: string;
  skipped?: boolean;
  reason?: string | null;
  message?: string;
}

export interface RemoteVault {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  default_permission: string;
  user_root_permission: string;
  total_files: number;
  total_bytes: number;
  latest_version: number;
  updated_at: string;
  is_e2ee?: boolean;
  e2ee_salt?: string | null;
}

export interface RemoteFileManifestItem {
  path: string;
  sha256: string;
  size: number;
  version: number;
  permission: 'read_write' | 'read_only' | 'hidden';
  updated_at: string;
  is_ghost?: boolean;
  original_size?: number;
  mime_type?: string;
  is_encrypted?: boolean;
  encryption_iv?: string;
  encryption_tag?: string;
}

export interface RemoteDeletedItem {
  path: string;
  version: number;
}

export interface ManifestCapabilities {
  e2ee?: boolean;
  whole_file_sync?: boolean;
  realtime_collaboration?: boolean;
  version_history?: boolean;
  ghost_files?: boolean;
  [key: string]: boolean | undefined;
}

export interface ManifestResponse {
  status: string;
  protocol_version?: number;
  minimum_protocol_version?: number;
  capabilities?: ManifestCapabilities;
  vault: {
    id: number;
    name: string;
    slug: string;
    latest_version: number;
    is_e2ee?: boolean;
    e2ee_salt?: string | null;
  };
  files: RemoteFileManifestItem[];
  deleted: RemoteDeletedItem[];
  server_time: string;
}

export interface LocalFileState {
  sha256?: string;
  localPlaintextSha256?: string;
  remotePayloadSha256?: string;
  mtime: number;
  version: number;
  is_encrypted?: boolean;
}

export interface SyncStateData {
  lastSyncVersion: number;
  files: { [path: string]: LocalFileState };
}

export interface VerifyAuthResponse {
  status: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
  team: {
    id: number;
    name: string;
    slug: string;
  };
  device: {
    id: number;
    name: string;
    platform: string;
  };
  broadcasting?: BroadcastingConfig;
}

export interface UploadResponse {
  status: 'created' | 'updated' | 'identical' | 'conflict';
  path: string;
  version: number;
  sha256?: string;
  size?: number;
  is_conflict?: boolean;
  conflict_path?: string;
  original_path?: string;
  has_secrets?: boolean;
  detected_secrets?: string[];
  message?: string;
}

export interface RagCitation {
  note: string;
  heading: string | null;
  start_line: number;
  similarity: number;
  score_pct: number;
  excerpt: string;
}

export interface RagGraphNode {
  path: string;
  title: string;
  relationship: string;
  via: string;
  excerpt?: string | null;
}

export interface RagQueryResponse {
  status: string;
  query: string;
  answer: string;
  citations: RagCitation[];
  graph_nodes: RagGraphNode[];
  model: string;
  duration_ms: number;
}

export interface RagSearchResult {
  file_id: number;
  path: string;
  heading: string | null;
  start_line: number;
  similarity: number;
  score_pct: number;
  content: string;
  wikilinks: string[];
}

export interface RagStatusResponse {
  status: string;
  indexed: boolean;
  total_files: number;
  total_chunks: number;
  embedding_provider: string;
  llm_provider: string;
  last_indexed_at: string | null;
}

export interface VaultPreflightRequest {
  total_files: number;
  total_bytes: number;
  categories?: Record<string, { count: number; bytes: number }>;
  files?: Array<{ path: string; size?: number; sha256?: string }>;
}

export interface VaultPreflightResponse {
  status: 'ready' | 'quota_exceeded';
  authorized: boolean;
  message?: string;
  vault?: {
    id: number;
    slug: string;
    name: string;
    version: number;
    server_files_count: number;
    server_bytes: number;
  };
  quota: {
    allowed: boolean;
    current_storage_bytes: number;
    additional_bytes: number;
    storage_limit_bytes: number;
    remaining_bytes?: number;
    deficit_bytes?: number;
  };
  simulation?: {
    to_upload_count: number;
    to_download_count: number;
    identical_skipped_count: number;
    bandwidth_saved_bytes: number;
  };
  safety?: {
    atomic_shield_active: boolean;
    max_deletion_threshold_percent: number;
    max_bulk_deletions: number;
  };
  recommendation?: string;
}
