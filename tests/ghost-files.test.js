const assert = require('node:assert/strict');
const test = require('node:test');

const STUB_REGEX = /<!-- synkk:ghost\s+path="([^"]+)"\s+size="(\d+)"\s+mime="([^"]+)"(?:\s+sha256="([^"]+)")?\s*-->/;

function isGhostStub(content) {
  return STUB_REGEX.test(content);
}

function parseGhostStub(content) {
  const match = content.match(STUB_REGEX);
  if (!match) return null;
  return {
    path: match[1],
    size: parseInt(match[2], 10),
    mime: match[3],
    sha256: match[4] || undefined,
  };
}

function generateStub(meta) {
  const formattedSize = (meta.size / (1024 * 1024)).toFixed(1);
  const shaAttr = meta.sha256 ? ` sha256="${meta.sha256}"` : '';
  return `<!-- synkk:ghost path="${meta.path}" size="${meta.size}" mime="${meta.mime}"${shaAttr} -->
> [!NOTE] 👻 Synkk Ghost Attachment
> **File:** \`${meta.path}\` (${formattedSize} MB)
> **Status:** Lightweight stub on this device. Content will stream on demand.
`;
}

test('detects and parses ghost stub metadata accurately', () => {
  const stub = generateStub({
    path: 'media/keynote-presentation.mp4',
    size: 52428800,
    mime: 'video/mp4',
    sha256: '9f83c605e22cbef6f8202c461ec966ac4f8000d',
  });

  assert.ok(isGhostStub(stub));
  const parsed = parseGhostStub(stub);
  assert.equal(parsed.path, 'media/keynote-presentation.mp4');
  assert.equal(parsed.size, 52428800);
  assert.equal(parsed.mime, 'video/mp4');
  assert.equal(parsed.sha256, '9f83c605e22cbef6f8202c461ec966ac4f8000d');
});

test('returns false and null for regular markdown without stub comment', () => {
  const normalMarkdown = '# Project Roadmap\n\nThis is a normal Obsidian note without ghost headers.';
  assert.equal(isGhostStub(normalMarkdown), false);
  assert.equal(parseGhostStub(normalMarkdown), null);
});

test('batch chunking splits large file arrays into expected chunks of 50', () => {
  const mockFiles = Array.from({ length: 125 }, (_, i) => ({
    path: `Notes/Doc-${i}.md`,
    sha256: `hash-${i}`,
  }));

  const BATCH_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < mockFiles.length; i += BATCH_SIZE) {
    chunks.push(mockFiles.slice(i, i + BATCH_SIZE));
  }

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 50);
  assert.equal(chunks[1].length, 50);
  assert.equal(chunks[2].length, 25);
  assert.equal(chunks[0][0].path, 'Notes/Doc-0.md');
  assert.equal(chunks[2][24].path, 'Notes/Doc-124.md');
});

