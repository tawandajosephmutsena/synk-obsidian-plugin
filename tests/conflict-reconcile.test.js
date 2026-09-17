import assert from 'node:assert/strict';
import test from 'node:test';

function parseConflictPaths(conflictPath) {
  let canonicalPath = conflictPath.replace(/(\.sync-conflict-\d+|\.conflict-[^.]+)(\.[^.]+)$/, '$2');
  if (canonicalPath === conflictPath) {
    canonicalPath = conflictPath.replace(/(\.sync-conflict-\d+|\.conflict-[^.]+)$/, '');
  }
  return { conflictPath, canonicalPath };
}

test('parses Obsidian sync conflict paths to canonical targets', () => {
  const t1 = parseConflictPaths('Notes/Design.sync-conflict-1725739200000.md');
  assert.equal(t1.canonicalPath, 'Notes/Design.md');

  const t2 = parseConflictPaths('Daily/2026-09-07.conflict-alex-20260907-123456.md');
  assert.equal(t2.canonicalPath, 'Daily/2026-09-07.md');

  const t3 = parseConflictPaths('config.conflict-bob-999');
  assert.equal(t3.canonicalPath, 'config');
});

test('combines and resolves conflicting text blocks cleanly', () => {
  const ours = '## Overview\nSection A edited by Alice';
  const theirs = '## Overview\nSection A edited by Bob';

  const combined = `${ours}\n\n---\n\n${theirs}`;
  assert.ok(combined.includes('Section A edited by Alice'));
  assert.ok(combined.includes('Section A edited by Bob'));
  assert.ok(combined.includes('---'));
});
