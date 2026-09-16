const assert = require('node:assert/strict');
const test = require('node:test');

const {
  categorizeFile,
  detectFriction,
  formatBytes,
  sanitizePath,
  scanVaultFiles,
  buildPreflightPayload,
} = require('../src/preflightScannerCore.js');

test('categorizes files into appropriate media and document types', () => {
  assert.equal(categorizeFile('Notes/Deep Work.md'), 'markdown');
  assert.equal(categorizeFile('Diagrams/Architecture.canvas'), 'canvas');
  assert.equal(categorizeFile('Assets/cover.png'), 'images');
  assert.equal(categorizeFile('Assets/hero.WEBP'), 'images');
  assert.equal(categorizeFile('Audio/interview.mp3'), 'audio_video');
  assert.equal(categorizeFile('Video/demo.mp4'), 'audio_video');
  assert.equal(categorizeFile('Papers/whitepaper.pdf'), 'pdf');
  assert.equal(categorizeFile('.obsidian/community-plugins.json'), 'config');
  assert.equal(categorizeFile('Data/export.sqlite'), 'other');
  assert.equal(categorizeFile('Scripts/run'), 'other');
});

test('detects friction flags: trash, git, oversized, invalid chars, whitespace', () => {
  // Trash
  const trashFriction = detectFriction('.trash/Old Note.md', 1024);
  assert.equal(trashFriction.length, 1);
  assert.equal(trashFriction[0].type, 'trash');

  // Git
  const gitFriction = detectFriction('Projects/.git/index', 2048);
  assert.equal(gitFriction.length, 1);
  assert.equal(gitFriction[0].type, 'git');

  // Oversized
  const normalFriction = detectFriction('media/small.png', 5 * 1024 * 1024);
  assert.equal(normalFriction.length, 0);

  const giantFriction = detectFriction('media/huge_recording.mov', 60 * 1024 * 1024);
  assert.equal(giantFriction.length, 1);
  assert.equal(giantFriction[0].type, 'oversized');

  // Cross-platform invalid characters
  const charFriction = detectFriction('Daily: 2026? <log>|notes.md', 500);
  assert.ok(charFriction.some((f) => f.type === 'invalid_chars'));

  // Leading / trailing whitespace in segments
  const spaceFriction = detectFriction('Folder /Note with trailing space .md', 500);
  assert.ok(spaceFriction.some((f) => f.type === 'leading_trailing_spaces'));
});

test('formats byte sizes into clean human-readable metrics', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
});

test('sanitizes unsafe cross-platform paths', () => {
  const unsafe = 'Folder: Name / Sub?Folder / <Title>|Report?.md ';
  const cleaned = sanitizePath(unsafe);

  assert.equal(cleaned.includes(':'), false);
  assert.equal(cleaned.includes('?'), false);
  assert.equal(cleaned.includes('<'), false);
  assert.equal(cleaned.includes('>'), false);
  assert.equal(cleaned.includes('|'), false);
  assert.equal(cleaned.endsWith(' '), false);
});

test('scans vault files, computes category rollups, and calculates exclusion bandwidth savings', () => {
  const sampleVaultFiles = [
    { path: 'Notes/Index.md', size: 2000 },
    { path: 'Notes/Ideas.md', size: 3000 },
    { path: 'Diagrams/System.canvas', size: 15000 },
    { path: 'Assets/photo.jpg', size: 500000 },
    { path: 'Video/podcast.mp4', size: 30 * 1024 * 1024 }, // oversized
    { path: '.trash/Deleted.md', size: 5000 }, // excluded by policy
    { path: '.git/objects/pack.pack', size: 1000000 }, // excluded by policy
    { path: 'Archive/Old.md', size: 4000 },
  ];

  const options = {
    settings: {
      includedPaths: '',
      excludedPaths: 'Archive',
      syncPluginList: false,
      syncSnippets: false,
      syncPluginData: false,
    },
    oversizedThresholdBytes: 25 * 1024 * 1024,
  };

  const result = scanVaultFiles(sampleVaultFiles, options);

  assert.equal(result.totalFiles, 8);
  // Total raw bytes
  const expectedRawBytes = 2000 + 3000 + 15000 + 500000 + (30 * 1024 * 1024) + 5000 + 1000000 + 4000;
  assert.equal(result.totalBytes, expectedRawBytes);

  // Effective files: Index, Ideas, System.canvas, Assets/photo, Video/podcast = 5 files
  // (.trash, .git, and Archive/Old are excluded by policy)
  assert.equal(result.effectiveFiles, 5);
  assert.ok(result.savingsBytes > 1000000);
  assert.ok(result.savingsPercent > 0);

  // Categories
  assert.equal(result.categories.markdown.count, 4); // Index, Ideas, .trash/Deleted, Archive/Old
  assert.equal(result.categories.canvas.count, 1);
  assert.equal(result.categories.images.count, 1);
  assert.equal(result.categories.audio_video.count, 1);

  // Friction items found (oversized podcast, trash, git)
  assert.ok(result.frictionItems.some((f) => f.type === 'oversized'));
  assert.ok(result.frictionItems.some((f) => f.type === 'trash'));
  assert.ok(result.frictionItems.some((f) => f.type === 'git'));
});

test('generates valid preflight request payload for backend simulation', () => {
  const scan = {
    totalFiles: 10,
    totalBytes: 50000,
    effectiveFiles: 8,
    effectiveBytes: 42000,
    savingsBytes: 8000,
    savingsPercent: 16.0,
    categories: {
      markdown: { count: 5, bytes: 20000 },
      canvas: { count: 1, bytes: 5000 },
      images: { count: 2, bytes: 17000 },
      audio_video: { count: 0, bytes: 0 },
      pdf: { count: 0, bytes: 0 },
      config: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    },
    frictionItems: [],
    fileList: [
      { path: 'Note1.md', size: 10000 },
      { path: 'Note2.md', size: 10000 },
    ],
    hasSevereFriction: false,
  };

  const payload = buildPreflightPayload(scan);
  assert.equal(payload.total_files, 8);
  assert.equal(payload.total_bytes, 42000);
  assert.equal(payload.categories.markdown.count, 5);
  assert.equal(payload.categories.audio_video, undefined); // omitted when 0
  assert.equal(payload.files.length, 2);
});
