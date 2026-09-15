export interface FileState {
  localPlaintextSha256?: string;
  remotePayloadSha256?: string;
  sha256?: string;
  mtime: number;
  version: number;
  is_encrypted?: boolean;
}

export interface ReconcileDecision {
  needsDownload: boolean;
  isConflict: boolean;
}

export function computeServerHash(serverUrl: string | null | undefined): string;

export function getIsolatedStatePath(
  serverUrl: string | null | undefined,
  vaultSlug: string | null | undefined,
  configDir?: string | null
): string;

export function isFileModifiedLocally(localSha: string, knownState?: FileState | null): boolean;

export function reconcileRemotePull(
  remoteFile: { sha256: string; version?: number },
  localSha: string,
  knownState?: FileState | null
): ReconcileDecision;

export function createFileState(options: {
  localPlaintextSha: string;
  remotePayloadSha: string;
  version?: number;
  mtime?: number;
  isEncrypted?: boolean;
}): FileState;
