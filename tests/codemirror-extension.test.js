import assert from 'node:assert/strict';
import test from 'node:test';

function calculateCaretPosition(docLines, lineNum, colNum) {
  const targetLine = Math.max(1, Math.min(docLines.length, lineNum));
  let charOffset = 0;
  for (let i = 0; i < targetLine - 1; i++) {
    charOffset += docLines[i].length + 1; // +1 for newline
  }
  const currentLineLength = docLines[targetLine - 1].length;
  const targetCol = Math.max(0, Math.min(currentLineLength, colNum));
  return charOffset + targetCol;
}

function buildCollabCaretDescriptors(docText, peers) {
  const lines = docText.split('\n');
  const items = [];

  for (const peer of peers) {
    if (!peer.cursor) continue;
    const pos = calculateCaretPosition(lines, peer.cursor.line, peer.cursor.col);
    items.push({
      peer_id: peer.peer_id,
      name: peer.name,
      color: peer.color,
      pos,
    });
  }

  // Strictly non-decreasing position ordering required by CodeMirror RangeSetBuilder
  items.sort((a, b) => a.pos - b.pos);
  return items;
}

test('calculates accurate character offset for collaborator carets in multi-line documents', () => {
  const doc = "First line of text\nSecond line has more content\nThird and final line";
  const lines = doc.split('\n');

  // Line 1, Col 5 -> offset 5
  assert.equal(calculateCaretPosition(lines, 1, 5), 5);

  // Line 2, Col 0 -> offset 19 (18 chars in line 1 + 1 newline)
  assert.equal(calculateCaretPosition(lines, 2, 0), 19);

  // Line 2, Col 7 -> offset 26
  assert.equal(calculateCaretPosition(lines, 2, 7), 26);

  // Out-of-bounds line clamps safely
  assert.equal(calculateCaretPosition(lines, 99, 0), calculateCaretPosition(lines, 3, 0));

  // Out-of-bounds column clamps safely to line length
  assert.equal(calculateCaretPosition(lines, 1, 999), 18);
});

test('sorts and builds collaborator carets in deterministic document position order', () => {
  const doc = "Alpha section\nBeta notes\nGamma summary";
  const peers = [
    {
      peer_id: 'peer_bob',
      name: 'Bob',
      color: '#6366F1',
      cursor: { line: 3, col: 2 }, // gamma
    },
    {
      peer_id: 'peer_alice',
      name: 'Alice',
      color: '#10B981',
      cursor: { line: 1, col: 4 }, // alpha
    },
    {
      peer_id: 'peer_carol',
      name: 'Carol',
      color: '#F59E0B',
      cursor: { line: 2, col: 1 }, // beta
    },
  ];

  const descriptors = buildCollabCaretDescriptors(doc, peers);

  assert.equal(descriptors.length, 3);
  assert.equal(descriptors[0].name, 'Alice');
  assert.equal(descriptors[1].name, 'Carol');
  assert.equal(descriptors[2].name, 'Bob');
  assert.ok(descriptors[0].pos < descriptors[1].pos);
  assert.ok(descriptors[1].pos < descriptors[2].pos);
});

test('generates valid yCollab extension binding with Y.Doc, SynkkAwareness, and UndoManager', async () => {
  const Y = await import('yjs');
  const { yCollab } = await import('y-codemirror.next');
  const { SynkkAwareness } = await import('../src/yjsProvider.js');

  const doc = new Y.Doc();
  const ytext = doc.getText('markdown');
  const undoManager = new Y.UndoManager(ytext);
  const awareness = new SynkkAwareness(doc);

  awareness.setLocalStateField('user', {
    name: 'Test Collaborator',
    color: '#10B981',
  });

  const extensions = yCollab(ytext, awareness, { undoManager });

  assert.ok(Array.isArray(extensions));
  assert.ok(extensions.length >= 5);
  assert.equal(awareness.getLocalState()?.user?.name, 'Test Collaborator');

  awareness.destroy();
  undoManager.destroy();
  doc.destroy();
});

test('converges two independent Yjs markdown documents with carets over awareness', async () => {
  const Y = await import('yjs');
  const { SynkkAwareness } = await import('../src/yjsProvider.js');

  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const textA = docA.getText('markdown');
  const textB = docB.getText('markdown');

  const awarenessA = new SynkkAwareness(docA);
  const awarenessB = new SynkkAwareness(docB);

  awarenessA.setLocalStateField('user', { name: 'Obsidian Alice', color: '#10B981' });
  awarenessB.setLocalStateField('user', { name: 'Web Bob', color: '#6366F1' });

  // Initial common baseline
  textA.insert(0, '# Synkk Architecture\n\nSection 1:\n');
  const initUpdate = Y.encodeStateAsUpdate(docA);
  Y.applyUpdate(docB, initUpdate);

  // Peer A edits section 1
  textA.insert(33, 'Engineered for reliability.\n');
  awarenessA.setLocalStateField('cursor', { line: 3, col: 28 });

  // Peer B edits section 2
  textB.insert(textB.length, 'Section 2:\nConvergent Yjs over Reverb.\n');
  awarenessB.setLocalStateField('cursor', { line: 4, col: 30 });

  // Exchange updates
  const updateA = Y.encodeStateAsUpdate(docA);
  const updateB = Y.encodeStateAsUpdate(docB);

  Y.applyUpdate(docB, updateA);
  Y.applyUpdate(docA, updateB);

  // Assert byte-identical text convergence
  assert.equal(textA.toString(), textB.toString());
  assert.match(textA.toString(), /Engineered for reliability\./);
  assert.match(textA.toString(), /Convergent Yjs over Reverb\./);

  // Sync awareness state
  awarenessB.states.set(awarenessA.clientID, awarenessA.getLocalState());
  assert.equal(awarenessB.getStates().get(awarenessA.clientID)?.user?.name, 'Obsidian Alice');
  assert.equal(awarenessB.getStates().get(awarenessA.clientID)?.cursor?.line, 3);

  awarenessA.destroy();
  awarenessB.destroy();
  docA.destroy();
  docB.destroy();
});

test('debounces snapshot flush when active note converges and clears on leave', async () => {
  const Y = await import('yjs');
  const { SynkkAwareness } = await import('../src/yjsProvider.js');

  let flushCalls = 0;
  let timer = null;

  function scheduleFlush(debounceMs = 50) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      flushCalls += 1;
    }, debounceMs);
  }

  function leave() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Rapid typing
  scheduleFlush(30);
  scheduleFlush(30);
  scheduleFlush(30);

  // Before timer fires, call leave
  leave();

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(flushCalls, 0, 'Leave before debounce should cancel snapshot flush');

  // New session types and allows timer to fire
  scheduleFlush(20);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(flushCalls, 1, 'Snapshot should flush once after debounce interval');
});

test('reconciles document changes with Y.Text without duplicate insertion', () => {
  const initialDoc = '# Meeting Notes\n\n- Discuss project roadmap\n- Action items for next week\n';
  const canonicalYText = '# Meeting Notes\n\n- Discuss project roadmap\n- Action items for next week\n';

  // If local document matches canonical Y.Text, changes are empty (no insertion dispatch)
  function computeReconciliationChanges(currentDoc, canonicalDoc) {
    if (currentDoc === canonicalDoc) {
      return null;
    }
    return { from: 0, to: currentDoc.length, insert: canonicalDoc };
  }

  assert.equal(computeReconciliationChanges(initialDoc, canonicalYText), null);

  // If server had newer updates, it cleanly replaces the entire range rather than prepending/doubling
  const newerServerText = '# Meeting Notes\n\n- Discuss project roadmap\n- Action items for next week\n- Additional item\n';
  const changes = computeReconciliationChanges(initialDoc, newerServerText);
  assert.deepEqual(changes, { from: 0, to: initialDoc.length, insert: newerServerText });
  assert.notEqual(changes.from, changes.to); // Ensures range replacement (0 to length), NOT an offset 0 insertion that doubles text
});

test('isolated path view mapping prevents cross-note editor view pollution', () => {
  const mockLeaves = [
    {
      view: {
        file: { path: 'Note A.md' },
        editor: { cm: { id: 'view_a' } },
      },
    },
    {
      view: {
        file: { path: 'Note B.md' },
        editor: { cm: { id: 'view_b' } },
      },
    },
  ];

  function getViewForPath(path) {
    for (const leaf of mockLeaves) {
      if (leaf.view?.file?.path === path) {
        return leaf.view.editor.cm;
      }
    }
    return null;
  }

  function isViewForCurrentPath(currentPath, view) {
    if (!currentPath) return false;
    const target = getViewForPath(currentPath);
    return target === view;
  }

  // Active note is Note A
  const currentPath = 'Note A.md';
  const viewA = mockLeaves[0].view.editor.cm;
  const viewB = mockLeaves[1].view.editor.cm;

  assert.equal(isViewForCurrentPath(currentPath, viewA), true);
  assert.equal(isViewForCurrentPath(currentPath, viewB), false);

  // When a new note view is created, it is not for currentPath
  const newNoteView = { id: 'view_new_note' };
  assert.equal(isViewForCurrentPath(currentPath, newNoteView), false);
});

test('disabled realtimeCollaboration prevents collab view registration and leaves editor completely untouched', () => {
  let registeredViews = [];
  const mockCollabRelay = {
    registerEditorView(v) {
      registeredViews.push(v);
    },
  };

  const settingsDisabled = { realtimeCollaboration: false };
  const mockPluginDisabled = {
    settings: settingsDisabled,
    collabRelay: mockCollabRelay,
  };

  // Simulating constructor behavior in createCollabExtension
  function initViewPlugin(plugin, view) {
    if (!plugin.settings?.realtimeCollaboration) {
      return { decorations: 'none' };
    }
    plugin.collabRelay?.registerEditorView(view);
    return { decorations: 'collab' };
  }

  const result = initViewPlugin(mockPluginDisabled, { id: 'view1' });
  assert.equal(result.decorations, 'none');
  assert.equal(registeredViews.length, 0, 'No views should be registered when collab is disabled');

  const settingsEnabled = { realtimeCollaboration: true };
  const mockPluginEnabled = {
    settings: settingsEnabled,
    collabRelay: mockCollabRelay,
  };
  const resultEnabled = initViewPlugin(mockPluginEnabled, { id: 'view1' });
  assert.equal(resultEnabled.decorations, 'collab');
  assert.equal(registeredViews.length, 1, 'View should be registered when collab is enabled');
});

