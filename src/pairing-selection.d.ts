export function applyPairingVaultSelection(
  settings: { selectedVaultSlug: string },
  vaultSlug: string | null | undefined
): { hasSelectedVault: boolean; description: string };
