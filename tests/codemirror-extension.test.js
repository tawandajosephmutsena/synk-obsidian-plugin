const assert = require('node:assert/strict');
const test = require('node:test');

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
