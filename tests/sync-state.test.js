import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeServerHash,
  getIsolatedStatePath,
  isFileModifiedLocally,
  reconcileRemotePull,
  createFileState,
} from '../src/sync-state.js';

test('generates isolated state path per server and vault', () => {
  const path1 = getIsolatedStatePath('https://synkk.example.com/api/v1', 'work-vault');
  const path2 = getIsolatedStatePath('https://synkk.example.com/api/v1/', 'personal-vault');
  const path3 = getIsolatedStatePath('https://staging.synkk.io/api/v1', 'work-vault');

  assert.match(path1, /^\.obsidian\/synkk-state-[0-9a-f]{8}-work-vault\.json$/);
  assert.match(path2, /^\.obsidian\/synkk-state-[0-9a-f]{8}-personal-vault\.json$/);
  assert.match(path3, /^\.obsidian\/synkk-state-[0-9a-f]{8}-work-vault\.json$/);

  // Same server with or without trailing slash produces identical server hash
  const hash1 = computeServerHash('https://synkk.example.com/api/v1');
  const hash2 = computeServerHash('https://synkk.example.com/api/v1/');
  assert.equal(hash1, hash2);

  // Different servers produce different state paths
  assert.notEqual(path1, path3);

  // Different vaults on same server produce different state paths
  assert.notEqual(path1, path2);

  // Unsafe characters in vault slug are sanitized
  const unsafePath = getIsolatedStatePath('https://synkk.example.com', 'Vault/With Spaces & Slashes!');
  assert.match(unsafePath, /^\.obsidian\/synkk-state-[0-9a-f]{8}-Vault_With_Spaces___Slashes_\.json$/);
});

test('breaks E2EE infinite push loop by comparing against localPlaintextSha256', () => {
  const localPlaintextSha = 'plaintext-hash-abc123';
  const remoteCiphertextSha = 'ciphertext-hash-xyz789';

  const knownE2eeState = createFileState({
    localPlaintextSha,
    remotePayloadSha: remoteCiphertextSha,
    version: 5,
    isEncrypted: true,
  });

  assert.equal(knownE2eeState.localPlaintextSha256, localPlaintextSha);
  assert.equal(knownE2eeState.remotePayloadSha256, remoteCiphertextSha);

  // If local file has not changed on disk, isFileModifiedLocally MUST be false
  // Previously this was compared to remoteCiphertextSha and failed every single sync
  const isModified = isFileModifiedLocally(localPlaintextSha, knownE2eeState);
  assert.equal(isModified, false, 'Clean decrypted file must not be flagged as modified locally');

  // If user actually modifies local plaintext, it should detect modification
  const changedPlaintextSha = 'new-plaintext-hash-def456';
  assert.equal(isFileModifiedLocally(changedPlaintextSha, knownE2eeState), true);
});

test('falls back gracefully to legacy sha256 when localPlaintextSha256 is absent', () => {
  const legacyState = {
    sha256: 'legacy-hash-111',
    mtime: Date.now(),
    version: 1,
  };

  assert.equal(isFileModifiedLocally('legacy-hash-111', legacyState), false);
  assert.equal(isFileModifiedLocally('modified-hash-222', legacyState), true);
  assert.equal(isFileModifiedLocally('anything', null), true);
});

test('reconciles remote pull decisions and conflicts cleanly', () => {
  const localPlaintext = 'plain-v1';
  const remoteCiphertext = 'cipher-v1';

  const knownState = createFileState({
    localPlaintextSha: localPlaintext,
    remotePayloadSha: remoteCiphertext,
    version: 1,
    isEncrypted: true,
  });

  // Case 1: Remote unchanged, local unchanged -> no download, no conflict
  const case1 = reconcileRemotePull({ sha256: 'cipher-v1' }, localPlaintext, knownState);
  assert.deepEqual(case1, { needsDownload: false, isConflict: false });

  // Case 2: Remote updated (v2), local unchanged -> download, no conflict
  const case2 = reconcileRemotePull({ sha256: 'cipher-v2' }, localPlaintext, knownState);
  assert.deepEqual(case2, { needsDownload: true, isConflict: false });

  // Case 3: Remote updated (v2), local also modified ('plain-v2') -> download AND conflict
  const case3 = reconcileRemotePull({ sha256: 'cipher-v2' }, 'plain-v2-local', knownState);
  assert.deepEqual(case3, { needsDownload: true, isConflict: true });

  // Case 4: Remote unchanged, local modified -> no download (will push in step 4)
  const case4 = reconcileRemotePull({ sha256: 'cipher-v1' }, 'plain-v2-local', knownState);
  assert.deepEqual(case4, { needsDownload: false, isConflict: false });

  // Case 5: Untracked file already on disk when remote file arrives -> conflict
  const case5 = reconcileRemotePull({ sha256: 'cipher-v1' }, 'existing-untracked', null);
  assert.deepEqual(case5, { needsDownload: true, isConflict: true });

  // Case 6: Untracked file already on disk with identical hash to remote -> no download, no conflict
  const case6 = reconcileRemotePull({ sha256: 'identical-hash' }, 'identical-hash', null);
  assert.deepEqual(case6, { needsDownload: false, isConflict: false });
});
