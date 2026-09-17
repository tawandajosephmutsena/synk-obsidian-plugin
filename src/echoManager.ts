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

  if (!host) {
    try {
      const parsed = new URL(baseUrl);
      host = parsed.hostname;
      if (!scheme) scheme = parsed.protocol.replace(':', '');
      if (!port) {
        port = parsed.port ? parseInt(parsed.port, 10) : scheme === 'https' ? 443 : 80;
      }
    } catch {
      return null;
    }
  }

  const forceTLS = scheme === 'https' || port === 443;
  const signature = `${key}@${host}:${port}:${scheme || 'https'}:${token}`;

  return {
    broadcaster: 'reverb',
    key,
    wsHost: host,
    wsPort: port || (forceTLS ? 443 : 80),
    wssPort: port || (forceTLS ? 443 : 80),
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
  private echo: Echo<'reverb'> | null = null;
  private currentSignature: string = '';

  constructor(private plugin: SynkkPlugin) {}

  public getEcho(): Echo<'reverb'> | null {
    return this.echo;
  }

  public async connect(): Promise<Echo<'reverb'> | null> {
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
      (window as unknown as { Pusher?: typeof Pusher }).Pusher = Pusher;

      this.echo = new Echo<'reverb'>(config);
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
