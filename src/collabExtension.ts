import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, Extension } from '@codemirror/state';
import type SynkkPlugin from './main';
import { CollabPeer } from './collabRelay';

export class CollabCursorWidget extends WidgetType {
  name: string;
  color: string;

  constructor(name: string, color: string) {
    super();
    this.name = name;
    this.color = color;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'synkk-collab-cursor';
    wrap.style.borderLeft = `2px solid ${this.color}`;

    const label = document.createElement('span');
    label.className = 'synkk-collab-label';
    label.style.backgroundColor = this.color;
    label.textContent = this.name;

    wrap.appendChild(label);
    return wrap;
  }

  eq(other: CollabCursorWidget): boolean {
    return this.name === other.name && this.color === other.color;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function buildCollabDecorations(
  view: EditorView,
  peers: CollabPeer[]
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!peers || peers.length === 0) {
    return builder.finish();
  }

  const doc = view.state.doc;
  const items: Array<{ pos: number; peer: CollabPeer }> = [];

  for (const peer of peers) {
    if (!peer.cursor) continue;
    const targetLineNum = Math.max(1, Math.min(doc.lines, peer.cursor.line));
    const line = doc.line(targetLineNum);
    const col = Math.max(0, Math.min(line.length, peer.cursor.col));
    const pos = line.from + col;
    items.push({ pos, peer });
  }

  // RangeSetBuilder requires strictly non-decreasing position ordering
  items.sort((a, b) => a.pos - b.pos);

  for (const item of items) {
    const widget = Decoration.widget({
      widget: new CollabCursorWidget(item.peer.name, item.peer.color),
      side: 1,
    });
    builder.add(item.pos, item.pos, widget);
  }

  return builder.finish();
}

export function createCollabExtension(plugin: SynkkPlugin): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      unsubscribePeers: (() => void) | null = null;

      constructor(view: EditorView) {
        this.decorations = buildCollabDecorations(
          view,
          plugin.collabRelay?.activePeers || []
        );

        if (plugin.collabRelay) {
          this.unsubscribePeers = plugin.collabRelay.onPeersChange((peers) => {
            this.decorations = buildCollabDecorations(view, peers);
            view.requestMeasure();
          });
        }
      }

      update(update: ViewUpdate): void {
        // 1. If document changed or peers updated, rebuild decorations
        if (update.docChanged) {
          this.decorations = buildCollabDecorations(
            update.view,
            plugin.collabRelay?.activePeers || []
          );
        }

        // 2. Track local cursor position to relay to peers
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          const col = head - line.from;
          plugin.collabRelay?.updateLocalCursor(line.number, col);
        }
      }

      destroy(): void {
        if (this.unsubscribePeers) {
          this.unsubscribePeers();
          this.unsubscribePeers = null;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
