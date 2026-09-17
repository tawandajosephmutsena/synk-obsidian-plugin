import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkFilesForBatchUpload } from '../src/sync-policy.js';

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
    size: 1024,
  }));

  const chunks = chunkFilesForBatchUpload(mockFiles, 50, 8 * 1024 * 1024);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 50);
  assert.equal(chunks[1].length, 50);
  assert.equal(chunks[2].length, 25);
  assert.equal(chunks[0][0].path, 'Notes/Doc-0.md');
  assert.equal(chunks[2][24].path, 'Notes/Doc-124.md');
});

test('batch chunking splits files by cumulative byte limit to prevent HTTP 413 errors', () => {
  // 5 files of 3MB each with a maxBytes limit of 8MB
  const threeMegabytes = 3 * 1024 * 1024;
  const mockFiles = [
    { path: 'doc1.md', size: threeMegabytes },
    { path: 'doc2.md', size: threeMegabytes },
    { path: 'doc3.md', size: threeMegabytes },
    { path: 'doc4.md', size: threeMegabytes },
    { path: 'doc5.md', size: threeMegabytes },
  ];

  const chunks = chunkFilesForBatchUpload(mockFiles, 50, 8 * 1024 * 1024);

  // Chunk 1: doc1 + doc2 (6MB <= 8MB)
  // Chunk 2: doc3 + doc4 (6MB <= 8MB)
  // Chunk 3: doc5 (3MB <= 8MB)
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 2);
  assert.equal(chunks[1].length, 2);
  assert.equal(chunks[2].length, 1);
  assert.equal(chunks[0][0].path, 'doc1.md');
  assert.equal(chunks[0][1].path, 'doc2.md');
  assert.equal(chunks[1][0].path, 'doc3.md');
  assert.equal(chunks[2][0].path, 'doc5.md');
});

test('batch chunking safely isolates an oversized file larger than maxBytes into its own chunk', () => {
  const tenMegabytes = 10 * 1024 * 1024;
  const mockFiles = [
    { path: 'small1.md', size: 1024 },
    { path: 'huge-video.mp4', size: tenMegabytes },
    { path: 'small2.md', size: 1024 },
  ];

  const chunks = chunkFilesForBatchUpload(mockFiles, 50, 8 * 1024 * 1024);

  // Chunk 1: small1.md
  // Chunk 2: huge-video.mp4
  // Chunk 3: small2.md
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1);
  assert.equal(chunks[0][0].path, 'small1.md');
  assert.equal(chunks[1].length, 1);
  assert.equal(chunks[1][0].path, 'huge-video.mp4');
  assert.equal(chunks[2].length, 1);
  assert.equal(chunks[2][0].path, 'small2.md');
});

test('batch chunking handles empty or invalid inputs gracefully', () => {
  assert.deepEqual(chunkFilesForBatchUpload([]), []);
  assert.deepEqual(chunkFilesForBatchUpload(null), []);
  assert.deepEqual(chunkFilesForBatchUpload(undefined), []);
});

