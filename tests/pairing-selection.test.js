import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPairingVaultSelection } from '../src/pairing-selection.js';

test('pairing without a target vault clears stale selection and defers sync', () => {
  const settings = { selectedVaultSlug: 'previous-team-vault' };

  const selection = applyPairingVaultSelection(settings, '');

  assert.equal(settings.selectedVaultSlug, '');
  assert.equal(selection.hasSelectedVault, false);
  assert.match(selection.description, /No target vault selected/);
  assert.match(selection.description, /select it in plugin settings before syncing/);
  assert.doesNotMatch(selection.description, /Default/);
});

test('pairing with a target vault selects it and permits initial sync', () => {
  const settings = { selectedVaultSlug: 'previous-team-vault' };

  const selection = applyPairingVaultSelection(settings, 'new-team-vault');

  assert.equal(settings.selectedVaultSlug, 'new-team-vault');
  assert.equal(selection.hasSelectedVault, true);
  assert.equal(selection.description, 'Target Vault: new-team-vault');
});
