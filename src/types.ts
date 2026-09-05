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
  syncPluginList: boolean;
  syncSnippets: boolean;
  syncPluginData: boolean;
  deletionThresholdPercent: number;
  safetyOverrideForNextSync: boolean;
  lastSyncTime: number;
  lastSyncVersion: number;
  userRootPermission: string;
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
  syncPluginList: false,
  syncSnippets: false,
  syncPluginData: false,
  deletionThresholdPercent: 10,
  safetyOverrideForNextSync: false,
  lastSyncTime: 0,
  lastSyncVersion: 0,
  userRootPermission: 'read_write',
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
}

export interface RemoteFileManifestItem {
  path: string;
  sha256: string;
  size: number;
  version: number;
  permission: 'read_write' | 'read_only' | 'hidden';
  updated_at: string;
}

export interface RemoteDeletedItem {
  path: string;
  version: number;
}

export interface ManifestResponse {
  status: string;
  vault: {
    id: number;
    name: string;
    slug: string;
    latest_version: number;
  };
  files: RemoteFileManifestItem[];
  deleted: RemoteDeletedItem[];
  server_time: string;
}

export interface LocalFileState {
  sha256: string;
  mtime: number;
  version: number;
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
  message?: string;
}
