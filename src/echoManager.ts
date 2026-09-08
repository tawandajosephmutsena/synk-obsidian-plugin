import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type SynkkPlugin from './main';
import { BroadcastingConfig } from './types';

export interface ResolvedEchoConfig {
  broadcaster: 'reverb';
  key: string;
  wsHost: string;
  wsPort: number;
  wssPort: number;
  forceTLS: boolean;
  enabledTransports: ('ws' | 'wss')[];
  authEndpoint: string;
  auth: { headers: Record<string, string> };
  signature: string;
}

export function resolveEchoConfig(settings: {
  serverUrl?: string;
  deviceToken?: string;
  broadcasting?: BroadcastingConfig;
}): ResolvedEchoConfig | null {
  if (!settings.serverUrl || !settings.deviceToken) {
    return null;
  }

  const baseUrl = settings.serverUrl.replace(/\/+$/, '');
  const token = settings.deviceToken;
  const bConfig = settings.broadcasting;

  let host = bConfig?.host;
  let port = bConfig?.port;
  let scheme = bConfig?.scheme;
  let key = bConfig?.key || 'synkk-reverb-key';

  if (!host || !port || !scheme) {
    try {
      const parsed = new URL(baseUrl);
      host = host || parsed.hostname;
      scheme = scheme || (parsed.protocol === 'https:' ? 'https' : 'http');
      if (!port) {
        port = parsed.port ? parseInt(parsed.port, 10) : (scheme === 'https' ? 443 : 80);
      }
    } catch {
      host = host || 'localhost';
      scheme = scheme || 'https';
      port = port || 443;
    }
  }

  const forceTLS = scheme === 'https';
  const signature = `${key}@${host}:${port}:${scheme}:${token}`;

  return {
    broadcaster: 'reverb',
    key,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${baseUrl}/broadcasting/auth`,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Synkk-Protocol': '2',
      },
    },
    signature,
  };
}

export class SynkkEchoManager {
  private echo: Echo<any> | null = null;
  private currentSignature: string = '';

  constructor(private plugin: SynkkPlugin) {}

  public getEcho(): Echo<any> | null {
    return this.echo;
  }

  public async connect(): Promise<Echo<any> | null> {
    const config = resolveEchoConfig(this.plugin.settings);
    if (!config) {
      this.disconnect();
      return null;
    }

    if (this.echo && this.currentSignature === config.signature) {
      return this.echo;
    }

    this.disconnect();
    this.currentSignature = config.signature;

    try {
      (window as any).Pusher = Pusher;

      this.echo = new Echo(config as any);
      return this.echo;
    } catch (err) {
      console.error('Synkk: Failed to initialize Reverb Echo connection:', err);
      this.echo = null;
      return null;
    }
  }

  public disconnect(): void {
    if (this.echo) {
      try {
        this.echo.disconnect();
      } catch (e) {
        console.error('Synkk: Error during Echo disconnect:', e);
      }
      this.echo = null;
    }
    this.currentSignature = '';
  }
}
