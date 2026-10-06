export function applyPairingVaultSelection(settings, vaultSlug) {
  const selectedVaultSlug = typeof vaultSlug === 'string' ? vaultSlug.trim() : '';
  settings.selectedVaultSlug = selectedVaultSlug;

  return {
    hasSelectedVault: selectedVaultSlug !== '',
    description: selectedVaultSlug
      ? `Target Vault: ${selectedVaultSlug}`
      : 'No target vault selected. Create one in Synkk if needed, then select it in plugin settings before syncing.',
  };
}
