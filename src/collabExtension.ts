import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, Extension, Compartment } from '@codemirror/state';
import type SynkkPlugin from './main';
import { CollabPeer } from './collabRelay';

export const collabCompartment = new Compartment();

export class CollabCursorWidget extends WidgetType {
  name: string;
  color: string;

  constructor(name: string, color: string) {
    super();
    this.name = name;
    this.color = color;
  }

  toDOM(): HTMLElement {
    const wrap = createSpan({ cls: 'synkk-collab-cursor' });
    wrap.setCssStyles({ borderLeft: `2px solid ${this.color}` });

    const label = wrap.createSpan({ cls: 'synkk-collab-label', text: this.name });
    label.setCssStyles({ backgroundColor: this.color });

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
  return [
    collabCompartment.of([]),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        unsubscribePeers: (() => void) | null = null;
        view: EditorView;

        constructor(view: EditorView) {
          this.view = view;
          if (!plugin.settings?.realtimeCollaboration) {
            this.decorations = Decoration.none;
            return;
          }

          plugin.collabRelay?.registerEditorView(view);

          const isCollabActive = Boolean(
            plugin.collabRelay?.isViewForCurrentPath(view)
          );

          this.decorations = isCollabActive
            ? buildCollabDecorations(view, plugin.collabRelay?.activePeers || [])
            : Decoration.none;

          if (plugin.collabRelay) {
            this.unsubscribePeers = plugin.collabRelay.onPeersChange((peers) => {
              const active = Boolean(
                plugin.settings?.realtimeCollaboration &&
                plugin.collabRelay?.isViewForCurrentPath(view)
              );
              this.decorations = active
                ? buildCollabDecorations(view, peers)
                : Decoration.none;
              view.requestMeasure();
            });
          }
        }

        update(update: ViewUpdate): void {
          if (!plugin.settings?.realtimeCollaboration) return;

          const isCollabActive = Boolean(
            plugin.collabRelay?.isViewForCurrentPath(update.view)
          );

          if (update.docChanged) {
            this.decorations = isCollabActive
              ? buildCollabDecorations(update.view, plugin.collabRelay?.activePeers || [])
              : Decoration.none;
          }

          if (isCollabActive && (update.selectionSet || update.docChanged)) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            const col = head - line.from;
            plugin.collabRelay?.updateLocalCursor(line.number, col);
          }
        }

        destroy(): void {
          if (plugin.settings?.realtimeCollaboration) {
            plugin.collabRelay?.unregisterEditorView(this.view);
          }
          if (this.unsubscribePeers) {
            this.unsubscribePeers();
            this.unsubscribePeers = null;
          }
        }
      },
      {
        decorations: (v) => v.decorations,
      }
    ),
  ];
}
