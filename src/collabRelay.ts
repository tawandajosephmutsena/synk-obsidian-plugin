import { Notice, requestUrl } from 'obsidian';
import type SynkkPlugin from './main';

export interface CollabPeer {
  peer_id: string;
  user_id: number;
  name: string;
  color: string;
  cursor?: { line: number; col: number };
  last_seen?: number;
}

export class CollabRelayClient {
  plugin: SynkkPlugin;
  peerId: string;
  currentPath: string | null = null;
  currentClock = 0;
  activePeers: CollabPeer[] = [];
  heartbeatTimer: number | null = null;
  localCursor: { line: number; col: number } | null = null;
  private listeners: Array<(peers: CollabPeer[]) => void> = [];

  constructor(plugin: SynkkPlugin) {
    this.plugin = plugin;
    this.peerId = `obsidian_${Math.random().toString(36).substring(2, 10)}`;
  }

  onPeersChange(fn: (peers: CollabPeer[]) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.activePeers);
      } catch (e) {
        console.error('Error in collab listener:', e);
      }
    }
  }

  updateLocalCursor(line: number, col: number): void {
    if (this.localCursor && this.localCursor.line === line && this.localCursor.col === col) {
      return;
    }
    this.localCursor = { line, col };
  }

  async join(vaultSlug: string, path: string): Promise<void> {
    if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) return;

    this.currentPath = path;
    const url = `${this.plugin.settings.serverUrl.replace(/\/+$/, '')}/vaults/${vaultSlug}/collab/join`;

    try {
      const res = await requestUrl({
        url,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.plugin.settings.deviceToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          path,
          peer_id: this.peerId,
        }),
      });

      if (res.status === 200 && res.json) {
        this.currentClock = res.json.clock || 0;
        this.activePeers = (res.json.peers || []).filter((p: CollabPeer) => p.peer_id !== this.peerId);
        this.notifyListeners();
        this.startHeartbeat(vaultSlug, path);
      }
    } catch {
      // Graceful silence if offline
    }
  }

  startHeartbeat(vaultSlug: string, path: string) {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(async () => {
      if (this.currentPath === path) {
        await this.sync(vaultSlug, path, []);
      }
    }, 4000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async sync(vaultSlug: string, path: string, deltas: any[] = []): Promise<void> {
    if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) return;

    const url = `${this.plugin.settings.serverUrl.replace(/\/+$/, '')}/vaults/${vaultSlug}/collab/sync`;

    try {
      const res = await requestUrl({
        url,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.plugin.settings.deviceToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          path,
          peer_id: this.peerId,
          deltas,
          cursor: this.localCursor,
          since_clock: this.currentClock,
        }),
      });

      if (res.status === 200 && res.json) {
        this.currentClock = res.json.clock || this.currentClock;
        this.activePeers = (res.json.peers || []).filter((p: CollabPeer) => p.peer_id !== this.peerId);
        this.notifyListeners();
      }
    } catch {
      // Graceful silence
    }
  }

  async leave(vaultSlug: string, path: string): Promise<void> {
    this.stopHeartbeat();
    this.currentPath = null;
    this.activePeers = [];
    this.notifyListeners();

    if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) return;

    const url = `${this.plugin.settings.serverUrl.replace(/\/+$/, '')}/vaults/${vaultSlug}/collab/leave`;

    try {
      await requestUrl({
        url,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.plugin.settings.deviceToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          path,
          peer_id: this.peerId,
        }),
      });
    } catch {
      // Silence
    }
  }
}
