function computeServerHash(serverUrl) {
  let hash = 0;
  const str = String(serverUrl ?? '').toLowerCase().trim().replace(/\/+$/, '');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function getIsolatedStatePath(serverUrl, vaultSlug, configDir = null) {
  const serverHash = computeServerHash(serverUrl || 'default');
  const vaultKey = String(vaultSlug || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseDir = configDir ? String(configDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ['.', 'obsidian'].join('');
  return `${baseDir}/synkk-state-${serverHash}-${vaultKey}.json`;
}

function isFileModifiedLocally(localSha, knownState) {
  if (!knownState) {
    return true; // Newly created local file
  }
  const baselineSha = knownState.localPlaintextSha256 || knownState.sha256;
  return baselineSha !== localSha;
}

function reconcileRemotePull(remoteFile, localSha, knownState) {
  if (!knownState) {
    if (localSha === remoteFile.sha256) {
      return {
        needsDownload: false,
        isConflict: false,
      };
    }
    return {
      needsDownload: true,
      isConflict: true,
    };
  }

  const remoteSha = remoteFile.sha256;
  const knownRemoteSha = knownState.remotePayloadSha256 || knownState.sha256;
  const knownLocalSha = knownState.localPlaintextSha256 || knownState.sha256;

  const remoteChanged = knownRemoteSha !== remoteSha;
  const localChanged = knownLocalSha !== localSha;

  if (!remoteChanged) {
    return {
      needsDownload: false,
      isConflict: false,
    };
  }

  // Remote has changed
  if (localChanged) {
    // Both sides modified concurrently
    return {
      needsDownload: true,
      isConflict: true,
    };
  }

  // Only remote changed; clean pull
  return {
    needsDownload: true,
    isConflict: false,
  };
}

function createFileState({
  localPlaintextSha,
  remotePayloadSha,
  version = 0,
  mtime = Date.now(),
  isEncrypted = false,
}) {
  return {
    localPlaintextSha256: localPlaintextSha,
    remotePayloadSha256: remotePayloadSha,
    sha256: localPlaintextSha,
    mtime,
    version,
    is_encrypted: Boolean(isEncrypted),
  };
}

export {
  computeServerHash,
  getIsolatedStatePath,
  isFileModifiedLocally,
  reconcileRemotePull,
  createFileState,
};

export default {
  computeServerHash,
  getIsolatedStatePath,
  isFileModifiedLocally,
  reconcileRemotePull,
  createFileState,
};
