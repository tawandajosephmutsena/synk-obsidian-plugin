export interface PairingParams {
  server: string;
  session: string;
  vault?: string;
  v?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  serverUrl?: string;
  sessionId?: string;
  vaultSlug?: string;
  protocolVersion?: number;
}

/**
 * Validates origin security. Production connections require HTTPS.
 * Explicit local development origins (localhost, 127.0.0.1, .test, .local) may use HTTP.
 */
export function isOriginSecure(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl);
    if (url.protocol === 'https:') {
      return true;
    }
    if (url.protocol === 'http:') {
      const hostname = url.hostname.toLowerCase();
      const isPrivateIp =
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

      return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||
        hostname.endsWith('.test') ||
        hostname.endsWith('.local') ||
        isPrivateIp
      );
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parses and validates pairing parameters from an obsidian://synkk-pair URL or dictionary.
 */
export function validatePairingParams(params: Record<string, string | undefined>): ValidationResult {
  const server = params.server?.trim();
  const session = params.session?.trim();
  const vault = params.vault?.trim();
  const vStr = params.v?.trim();

  if (!server) {
    return { isValid: false, error: 'Missing required "server" URL in pairing payload.' };
  }

  if (!session) {
    return { isValid: false, error: 'Missing required "session" identifier in pairing payload.' };
  }

  try {
    new URL(server);
  } catch {
    return { isValid: false, error: `Invalid server URL format: "${server}".` };
  }

  if (!isOriginSecure(server)) {
    return {
      isValid: false,
      error: `Insecure server URL rejected: "${server}". HTTPS is strictly required for remote Synkk pairing.`,
    };
  }

  const protocolVersion = vStr ? parseInt(vStr, 10) : 2;
  if (isNaN(protocolVersion) || protocolVersion < 1) {
    return { isValid: false, error: `Unsupported protocol version "${vStr}".` };
  }

  return {
    isValid: true,
    serverUrl: server.replace(/\/+$/, ''),
    sessionId: session,
    vaultSlug: vault || undefined,
    protocolVersion,
  };
}

/**
 * Resolves appropriate device name and platform identifier for pairing.
 */
export function getDevicePlatformInfo(
  isMobile: boolean,
  isIos: boolean,
  isAndroid: boolean,
  isMac: boolean,
  isWin: boolean
): { platform: string; deviceName: string } {
  if (isMobile) {
    if (isIos) return { platform: 'ios', deviceName: 'iPhone (Obsidian)' };
    if (isAndroid) return { platform: 'android', deviceName: 'Android (Obsidian)' };
    return { platform: 'ios', deviceName: 'Mobile Device (Obsidian)' };
  }
  if (isMac) return { platform: 'mac', deviceName: 'Mac (Obsidian)' };
  if (isWin) return { platform: 'windows', deviceName: 'Windows PC (Obsidian)' };
  return { platform: 'linux', deviceName: 'Desktop (Obsidian)' };
}

import type SynkkPlugin from './main';
import type { BroadcastingConfig } from './types';

interface PairingResult {
  server_url: string;
  plain_token: string;
  vault_slug?: string;
  broadcasting?: BroadcastingConfig;
  team_slug?: string;
  access_scope?: string;
}

/**
 * Handles incoming obsidian://synkk-pair protocol events.
 */
export async function handlePairingProtocol(plugin: SynkkPlugin, params: Record<string, string | undefined>): Promise<void> {
  const validation = validatePairingParams(params);
  const { Notice: ObsNotice, Platform } = await import('obsidian');

  if (!validation.isValid) {
    new ObsNotice(`Synkk Pairing Error: ${validation.error}`, 8000);
    return;
  }

  const platformInfo = getDevicePlatformInfo(
    Platform.isMobile,
    Platform.isIosApp,
    Platform.isAndroidApp,
    Platform.isMacOS,
    Platform.isWin
  );

  new ObsNotice('⚡ Synkk: Exchanging one-scan pairing session...', 4000);

  try {
    const { SynkkApiClient } = await import('./apiClient');
    const rawResult = await SynkkApiClient.exchangePairing(
      validation.serverUrl!,
      validation.sessionId!,
      platformInfo.deviceName,
      platformInfo.platform
    );
    const result = rawResult as unknown as PairingResult;

    // Save newly issued scoped token and server configuration
    plugin.settings.serverUrl = result.server_url;
    plugin.settings.deviceToken = result.plain_token;
    if (result.vault_slug) {
      plugin.settings.selectedVaultSlug = result.vault_slug;
    }
    if (result.broadcasting) {
      plugin.settings.broadcasting = result.broadcasting;
    }
    await plugin.saveSettings();
    plugin.apiClient.updateConfig(result.server_url, result.plain_token);

    // Perform read-only connection check and establish Echo
    try {
      const auth = await plugin.apiClient.verifyAuth();
      if (auth.broadcasting && !plugin.settings.broadcasting) {
        plugin.settings.broadcasting = auth.broadcasting;
        await plugin.saveSettings();
      }
      if (plugin.echoManager) {
        await plugin.echoManager.connect();
      }
      const scopeLabel = result.access_scope === 'read_only' ? 'Read-Only' : 'Read & Write';
      new ObsNotice(
        `⚡ Synkk Paired Successfully!\nConnected to "${auth.team.name}" as ${auth.user.name} (${scopeLabel}).\nTarget Vault: ${result.vault_slug || 'Default'}`,
        9000
      );
    } catch {
      new ObsNotice(`⚡ Synkk paired! Linked to team ${result.team_slug || 'workspace'}.`, 6000);
    }

    // Trigger initial sync
    if (plugin.syncEngine) {
      plugin.syncEngine.sync();
    }
  } catch (err: unknown) {
    const status = err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : 0;
    const isExpired = err && typeof err === 'object' && 'isExpiredOrConsumed' in err ? Boolean((err as { isExpiredOrConsumed: boolean }).isExpiredOrConsumed) : false;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 410 || isExpired) {
      new ObsNotice('Synkk: Pairing session has expired or was already consumed. Please generate a new QR code.', 8000);
    } else {
      new ObsNotice(`Synkk Pairing Failed: ${message}`, 8000);
    }
  }
}
