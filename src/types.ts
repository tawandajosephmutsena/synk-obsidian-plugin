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
  ragEnabled: boolean;
  ragUseLocalOllama: boolean;
  ragOllamaUrl: string;
  broadcasting?: BroadcastingConfig;
}

export interface BroadcastingConfig {
  driver: string;
  key: string;
  host: string;
  port: number;
  scheme: string;
}

export const DEFAULT_SETTINGS: SynkkSettings = {
  serverUrl: 'https://synkk.ottomate.space/api/v1',
  deviceToken: '',
  selectedVaultSlug: '',
  selectedVaultName: '',
  autoSync: true,
  syncIntervalMinutes: 5,
  syncOnStartup: true,
  syncOnFileChange: false,
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
  ragEnabled: true,
  ragUseLocalOllama: false,
  ragOllamaUrl: 'http://localhost:11434',
};

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
