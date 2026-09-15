import { requestUrl, TFile } from 'obsidian';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import type { EditorView } from '@codemirror/view';
import type SynkkPlugin from './main';
import { collabCompartment } from './collabExtension';
import { SynkkYjsProvider, SynkkAwareness } from './yjsProvider';

export interface CollabPeer {
  peer_id: string;
  user_id?: number;
  name: string;
  color: string;
  cursor?: { line: number; col: number } | null;
  last_seen?: number;
}

export class CollabRelayClient {
  plugin: SynkkPlugin;
  peerId: string;
  currentPath: string | null = null;
  documentId: number | null = null;
  currentClock = 0;
  activePeers: CollabPeer[] = [];
  localCursor: { line: number; col: number } | null = null;

  ydoc: Y.Doc | null = null;
  ytext: Y.Text | null = null;
  undoManager: Y.UndoManager | null = null;
  awareness: SynkkAwareness | null = null;
  provider: SynkkYjsProvider | null = null;
  snapshotTimer: any = null;
  snapshotDebounceMs = 3000;
  isDirty = false;

  private activeViews: Set<EditorView> = new Set();
  private listeners: Array<(peers: CollabPeer[]) => void> = [];

  constructor(plugin: SynkkPlugin) {
    this.plugin = plugin;
    this.peerId = `obsidian_${Math.random().toString(36).substring(2, 10)}`;
  }

  registerEditorView(view: EditorView): void {
    this.activeViews.add(view);
    if (this.ytext && this.awareness && this.undoManager) {
      try {
        view.dispatch({
          effects: collabCompartment.reconfigure(
            yCollab(this.ytext, this.awareness, { undoManager: this.undoManager })
          ),
        });
      } catch (e) {
        console.error('Failed to attach yCollab to new view:', e);
      }
    }
  }

  unregisterEditorView(view: EditorView): void {
    this.activeViews.delete(view);
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
    if (this.awareness) {
      this.awareness.setLocalStateField('cursor', { line, col });
    }
  }

  async join(vaultSlug: string, path: string): Promise<void> {
    if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) return;

    if (this.currentPath && this.currentPath !== path) {
      await this.leave(vaultSlug, this.currentPath);
    }

    this.currentPath = path;
    const baseUrl = this.plugin.settings.serverUrl.replace(/\/+$/, '');
    const token = this.plugin.settings.deviceToken;

    try {
      const res = await requestUrl({
        url: `${baseUrl}/vaults/${vaultSlug}/collab/join`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          path,
          peer_id: this.peerId,
        }),
      });

      if (res.status === 200 && res.json) {
        this.documentId = res.json.document_id || null;
        this.currentClock = res.json.latest_sequence || res.json.clock || 0;
        this.activePeers = (res.json.peers || []).filter((p: CollabPeer) => p.peer_id !== this.peerId);
        this.notifyListeners();
      }
    } catch {
      // Graceful offline fallback
    }

    // Initialize Y.Doc & Y.Text
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('markdown');
    this.undoManager = new Y.UndoManager(this.ytext);
    this.awareness = new SynkkAwareness(this.ydoc);

    this.awareness.setLocalStateField('user', {
      name: this.plugin.settings.selectedVaultName || 'Obsidian User',
      color: '#10B981',
    });

    this.awareness.on('change', () => {
      if (!this.awareness) return;
      this.activePeers = Array.from(this.awareness.getStates().entries())
        .filter(([id]) => id !== this.awareness!.clientID)
        .map(([id, state]: [number, any]) => ({
          peer_id: String(id),
          name: state.user?.name || 'Collaborator',
          color: state.user?.color || '#10B981',
          cursor: state.cursor || null,
        }));
      this.notifyListeners();
    });

    // Seed local file content if present and ytext is empty
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const text = await this.plugin.app.vault.read(file);
        if (text && this.ytext.length === 0) {
          this.ydoc.transact(() => {
            this.ytext!.insert(0, text);
          }, 'local');
        }
      }
    } catch {
      // File read error
    }

    // Observe text mutations to debounce snapshot flush
    this.ytext.observe((_event, transaction) => {
      this.isDirty = true;
      this.scheduleSnapshotFlush(vaultSlug, path);
    });

    // Reconfigure CodeMirror views to bind yCollab
    const collabExt = yCollab(this.ytext, this.awareness, { undoManager: this.undoManager });
    for (const view of this.activeViews) {
      try {
        view.dispatch({
          effects: collabCompartment.reconfigure(collabExt),
        });
      } catch (e) {
        console.error('Failed to bind yCollab to view:', e);
      }
    }

    // Setup transport for SynkkYjsProvider
    const doAppend = async (payload: any) => {
      const resp = await requestUrl({
        url: `${baseUrl}/vaults/${vaultSlug}/collab/append`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          document_id: this.documentId,
          path,
          ...payload,
        }),
      });
      return resp.json;
    };

    const transport = {
      fetchUpdates: async (sinceSeq: number) => {
        try {
          const resp = await requestUrl({
            url: `${baseUrl}/vaults/${vaultSlug}/collab/catch-up?document_id=${this.documentId}&after_sequence=${sinceSeq}`,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
          });
          return resp.json;
        } catch {
          return { updates: [] };
        }
      },
      sendUpdate: doAppend,
      appendUpdate: doAppend,
      checkpoint: async (payload: any) => {
        try {
          const clientUpdateId = typeof crypto !== 'undefined' && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : `ckpt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          const resp = await requestUrl({
            url: `${baseUrl}/vaults/${vaultSlug}/collab/checkpoint`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              document_id: this.documentId,
              path,
              client_update_id: clientUpdateId,
              acknowledged_base_sequence: this.provider?.latestSequence || 0,
              payload: payload.checkpoint_snapshot,
              encrypted: payload.is_encrypted,
              iv: payload.encryption_iv,
              tag: payload.encryption_tag,
            }),
          });
          return resp.json;
        } catch (e) {
          console.error('Synkk: Checkpoint failed in CollabRelay:', e);
          return null;
        }
      },
    };

    const cryptoKey = (this.plugin.syncEngine as any)?.e2eeEngine?.getKey?.() || null;
    let echoInstance = null;
    if (this.plugin.echoManager) {
      echoInstance = await this.plugin.echoManager.connect();
    }

    this.provider = new SynkkYjsProvider({
      doc: this.ydoc,
      vaultId: vaultSlug,
      documentId: this.documentId,
      path,
      cryptoKey,
      e2eeEngine: (this.plugin.syncEngine as any)?.e2eeEngine,
      transport,
      echo: echoInstance,
      awareness: this.awareness,
    });

    await this.provider.connect();
  }

  scheduleSnapshotFlush(vaultSlug: string, path: string): void {
    if (this.snapshotTimer) {
      window.clearTimeout(this.snapshotTimer);
    }
    this.snapshotTimer = window.setTimeout(async () => {
      await this.flushDurableSnapshot(vaultSlug, path);
    }, this.snapshotDebounceMs);
  }

  async flushDurableSnapshot(vaultSlug: string, path: string): Promise<void> {
    if (!this.isDirty || !this.ytext) return;
    this.isDirty = false;

    try {
      const currentMarkdown = this.ytext.toString();
      // Write locally to file if necessary
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.plugin.app.vault.modify(file, currentMarkdown);
      }
      // Checkpoint the collaboration document on the server
      if (this.provider) {
        await this.provider.checkpoint();
      }
    } catch (e) {
      console.error('Failed to flush durable snapshot:', e);
    }
  }

  async leave(vaultSlug: string, path: string): Promise<void> {
    if (this.snapshotTimer) {
      window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    if (this.isDirty) {
      await this.flushDurableSnapshot(vaultSlug, path);
    }

    // Reconfigure CodeMirror views to empty extension
    for (const view of this.activeViews) {
      try {
        view.dispatch({
          effects: collabCompartment.reconfigure([]),
        });
      } catch (_e) {
        // view might already be destroyed
      }
    }

    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    if (this.awareness) {
      this.awareness.destroy();
      this.awareness = null;
    }
    if (this.undoManager) {
      this.undoManager.destroy();
      this.undoManager = null;
    }
    if (this.ydoc) {
      this.ydoc.destroy();
      this.ydoc = null;
      this.ytext = null;
    }

    this.currentPath = null;
    this.documentId = null;
    this.activePeers = [];
    this.notifyListeners();

    if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) return;

    try {
      await requestUrl({
        url: `${this.plugin.settings.serverUrl.replace(/\/+$/, '')}/vaults/${vaultSlug}/collab/leave`,
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
