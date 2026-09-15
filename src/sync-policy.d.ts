export interface DeletionGuardResult {
  blocked: boolean;
  percentage: number;
}

export function deletionGuard(
  paths: string[],
  baselineCount: number,
  thresholdPercent: number,
  hasOverride?: boolean
): DeletionGuardResult;

export function shouldSyncPath(
  path: string,
  settings?: {
    includedPaths?: string;
    excludedPaths?: string;
    configDir?: string;
    isMobile?: boolean;
    syncPluginSuite?: boolean;
    syncPluginList?: boolean;
    syncSnippets?: boolean;
    syncThemes?: boolean;
    syncPluginData?: boolean;
  }
): boolean;

export function isObsidianPathAllowed(
  path: string,
  settings?: {
    configDir?: string;
    isMobile?: boolean;
    syncPluginSuite?: boolean;
    syncPluginList?: boolean;
    syncSnippets?: boolean;
    syncThemes?: boolean;
    syncPluginData?: boolean;
  }
): boolean;

export function isPluginSafeForPlatform(pluginId: string | null, isMobile?: boolean): boolean;

export function chunkFilesForBatchUpload<T extends { buffer?: ArrayBuffer; byteLength?: number; size?: number }>(
  files: T[],
  maxCount?: number,
  maxBytes?: number
): T[][];
