const { shouldSyncPath } = require('./sync-policy.js');

const DEFAULT_OVERSIZED_THRESHOLD = 25 * 1024 * 1024; // 25 MB

const CATEGORY_EXTENSIONS = {
  markdown: ['.md'],
  canvas: ['.canvas'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.ico'],
  audio_video: ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.mp4', '.mov', '.webm', '.mkv', '.avi'],
  pdf: ['.pdf'],
};

/**
 * Categorize a file path based on its extension or directory hierarchy.
 */
function categorizeFile(path, configDir = '.obsidian') {
  const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();

  if (normalized.startsWith(`${configDir.toLowerCase()}/`) || normalized === configDir.toLowerCase()) {
    return 'config';
  }

  const dotIdx = normalized.lastIndexOf('.');
  if (dotIdx === -1) {
    return 'other';
  }

  const ext = normalized.substring(dotIdx);

  for (const [category, exts] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (exts.includes(ext)) {
      return category;
    }
  }

  return 'other';
}

/**
 * Detect cross-platform and migration friction issues on a single file.
 */
function detectFriction(path, size, oversizedThresholdBytes = DEFAULT_OVERSIZED_THRESHOLD) {
  const items = [];
  const normalized = String(path || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  // 1. Trash detection
  if (segments.includes('.trash') || normalized.startsWith('.trash/')) {
    items.push({
      type: 'trash',
      path,
      size,
      message: 'File is inside the Obsidian .trash directory.',
      suggestedAction: 'Exclude .trash from syncing to save team bandwidth and storage.',
    });
  }

  // 2. Git repository internal files
  if (segments.includes('.git') || normalized.startsWith('.git/')) {
    items.push({
      type: 'git',
      path,
      size,
      message: 'File is inside a local .git metadata directory.',
      suggestedAction: 'Exclude .git directory from Synkk to prevent corrupting Git repositories.',
    });
  }

  // 3. Oversized files
  if (size > oversizedThresholdBytes) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    const thresholdMb = (oversizedThresholdBytes / (1024 * 1024)).toFixed(0);
    items.push({
      type: 'oversized',
      path,
      size,
      message: `File size (${mb} MB) exceeds recommended first-sync limit (${thresholdMb} MB).`,
      suggestedAction: 'Enable Synkk Mobile Ghost Files or store large media in external storage.',
    });
  }

  // 4. Invalid cross-platform characters (Windows / Android / iOS filesystem restrictions)
  // Illegal characters: : * ? " < > | \ (or control characters)
  const illegalCharMatch = /[:*?"<>|\\]/.exec(normalized);
  if (illegalCharMatch) {
    items.push({
      type: 'invalid_chars',
      path,
      size,
      message: `Path contains illegal cross-platform character '${illegalCharMatch[0]}'.`,
      suggestedAction: 'Rename the file or note to avoid sync errors on Windows, iOS, or Android devices.',
    });
  }

  // 5. Leading or trailing whitespace in path segments
  const hasWhitespaceHazard = segments.some(
    (seg) => seg.startsWith(' ') || seg.endsWith(' ') || seg.endsWith('.')
  );
  if (hasWhitespaceHazard) {
    items.push({
      type: 'leading_trailing_spaces',
      path,
      size,
      message: 'Path segment contains leading/trailing spaces or trailing periods.',
      suggestedAction: 'Trim whitespace from folder or file name to maintain POSIX and Windows interoperability.',
    });
  }

  return items;
}

/**
 * Format bytes into readable string (e.g. 1.2 MB, 450 KB).
 */
function formatBytes(bytes) {
  const num = Number(bytes);
  if (!num || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
  const val = num / Math.pow(1024, i);
  const formatted = val >= 10 || val % 1 === 0 ? Math.round(val).toString() : val.toFixed(1);
  return `${formatted} ${units[i]}`;
}

/**
 * Sanitizes a file path to make it cross-platform safe.
 */
function sanitizePath(path) {
  return String(path || '')
    .split('/')
    .map((seg) =>
      seg
        .replace(/[:*?"<>|\\]/g, '-')
        .trim()
        .replace(/\.+$/, '')
    )
    .filter(Boolean)
    .join('/');
}

/**
 * Scan a list of vault files and compute preflight diagnostic summary.
 */
function scanVaultFiles(files, options = {}) {
  const oversizedLimit = options.oversizedThresholdBytes || DEFAULT_OVERSIZED_THRESHOLD;
  const settings = options.settings || {};

  const categories = {
    markdown: { count: 0, bytes: 0 },
    canvas: { count: 0, bytes: 0 },
    images: { count: 0, bytes: 0 },
    audio_video: { count: 0, bytes: 0 },
    pdf: { count: 0, bytes: 0 },
    config: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };

  let totalFiles = 0;
  let totalBytes = 0;
  let effectiveFiles = 0;
  let effectiveBytes = 0;

  const frictionItems = [];
  const fileList = [];

  const rawFiles = Array.isArray(files) ? files : [];

  for (const file of rawFiles) {
    const size = Math.max(0, Number(file.size) || 0);
    totalFiles++;
    totalBytes += size;

    const category = categorizeFile(file.path);
    if (categories[category]) {
      categories[category].count++;
      categories[category].bytes += size;
    } else {
      categories.other.count++;
      categories.other.bytes += size;
    }

    // Check for friction
    const frictions = detectFriction(file.path, size, oversizedLimit);
    if (frictions.length > 0) {
      frictionItems.push(...frictions);
    }

    // Determine if file is eligible under sync policy
    const isEligible = shouldSyncPath(file.path, {
      ...settings,
      isMobile: options.isMobile,
    });

    if (isEligible) {
      effectiveFiles++;
      effectiveBytes += size;
      fileList.push({ path: file.path, size });
    }
  }

  const savingsBytes = Math.max(0, totalBytes - effectiveBytes);
  const savingsPercent = totalBytes > 0 ? Number(((savingsBytes / totalBytes) * 100).toFixed(1)) : 0;
  const hasSevereFriction = frictionItems.some(
    (item) => item.type === 'invalid_chars' || item.type === 'leading_trailing_spaces'
  );

  return {
    totalFiles,
    totalBytes,
    effectiveFiles,
    effectiveBytes,
    savingsBytes,
    savingsPercent,
    categories,
    frictionItems,
    fileList,
    hasSevereFriction,
  };
}

/**
 * Generate a VaultPreflightRequest payload for sending to the Synkk backend.
 */
function buildPreflightPayload(scanResult) {
  const categoryMap = {};
  for (const [key, val] of Object.entries(scanResult?.categories || {})) {
    if (val.count > 0) {
      categoryMap[key] = { count: val.count, bytes: val.bytes };
    }
  }

  return {
    total_files: scanResult.effectiveFiles,
    total_bytes: scanResult.effectiveBytes,
    categories: categoryMap,
    files: scanResult.fileList,
  };
}

module.exports = {
  DEFAULT_OVERSIZED_THRESHOLD,
  categorizeFile,
  detectFriction,
  formatBytes,
  sanitizePath,
  scanVaultFiles,
  buildPreflightPayload,
};
