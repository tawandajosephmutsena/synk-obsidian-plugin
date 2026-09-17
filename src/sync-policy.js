const alwaysExcludedPrefixes = ['.git', '.trash', '.synkk'];

function normalizePath(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function resolveConfigDir(settings = {}) {
  return normalizePath(settings.configDir || ['.', 'obsidian'].join(''));
}

function getExcludedConfigPaths(configDir) {
  return [
    `${configDir}/synkk-state.json`,
    `${configDir}/workspace.json`,
    `${configDir}/workspace-mobile.json`,
    `${configDir}/hotkeys.json`,
    `${configDir}/cache`,
  ];
}

function parsePrefixes(value) {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((prefix) => normalizePath(prefix))
    .filter(Boolean);
}

function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const desktopOnlyPluginIds = [
  'obsidian-git',
  'terminal',
  'obsidian-terminal',
  'shell-commands',
  'execute-code',
  'local-rest-api',
  'system-dark-mode',
];

function getPluginIdFromPath(path, configDir) {
  const prefix = `${configDir}/plugins/`;
  if (!String(path).startsWith(prefix)) {
    return null;
  }
  const remaining = String(path).slice(prefix.length);
  const pluginId = remaining.split('/')[0];
  return pluginId ? pluginId.toLowerCase() : null;
}

function isPluginSafeForPlatform(pluginId, isMobile = false) {
  if (!isMobile || !pluginId) {
    return true;
  }
  return !desktopOnlyPluginIds.includes(pluginId.toLowerCase());
}

function isObsidianPathAllowed(path, settings = {}) {
  const configDir = resolveConfigDir(settings);

  if (path.startsWith(`${configDir}/synkk-state`)) {
    return false;
  }

  const excludedPaths = getExcludedConfigPaths(configDir);
  if (excludedPaths.some((prefix) => matchesPrefix(path, prefix))) {
    return false;
  }

  // Complete Vault Environment & Plugin Suite Sync
  if (settings.syncPluginSuite === true) {
    if (path === `${configDir}/community-plugins.json`) {
      return true;
    }
    if (matchesPrefix(path, `${configDir}/snippets`)) {
      return true;
    }
    if (matchesPrefix(path, `${configDir}/themes`)) {
      return true;
    }
    if (matchesPrefix(path, `${configDir}/plugins`)) {
      const pluginId = getPluginIdFromPath(path, configDir);
      return isPluginSafeForPlatform(pluginId, settings.isMobile === true);
    }
  }

  if (path === `${configDir}/community-plugins.json`) {
    return settings.syncPluginList === true;
  }

  if (matchesPrefix(path, `${configDir}/snippets`)) {
    return settings.syncSnippets === true;
  }

  if (matchesPrefix(path, `${configDir}/themes`)) {
    return settings.syncThemes === true;
  }

  if (matchesPrefix(path, `${configDir}/plugins`)) {
    const pluginId = getPluginIdFromPath(path, configDir);
    if (!isPluginSafeForPlatform(pluginId, settings.isMobile === true)) {
      return false;
    }
    return settings.syncPluginData === true;
  }

  return false;
}

function shouldSyncPath(path, settings = {}) {
  const normalizedPath = normalizePath(path);

  if (!normalizedPath || normalizedPath.endsWith('.DS_Store') || normalizedPath.includes('/.DS_Store')) {
    return false;
  }

  const configDir = resolveConfigDir(settings);

  const segments = normalizedPath.split('/');
  if (segments.some((seg) => seg.startsWith('.') && seg !== configDir)) {
    return false;
  }

  if (alwaysExcludedPrefixes.some((prefix) => matchesPrefix(normalizedPath, prefix))) {
    return false;
  }

  if (matchesPrefix(normalizedPath, configDir) && !isObsidianPathAllowed(normalizedPath, settings)) {
    return false;
  }

  const includedPrefixes = parsePrefixes(settings.includedPaths);
  const excludedPrefixes = parsePrefixes(settings.excludedPaths);

  if (excludedPrefixes.some((prefix) => matchesPrefix(normalizedPath, prefix))) {
    return false;
  }

  return includedPrefixes.length === 0 || includedPrefixes.some((prefix) => matchesPrefix(normalizedPath, prefix));
}

function deletionGuard(paths, baselineCount, thresholdPercent, hasOverride) {
  const normalizedBaselineCount = Math.max(0, Number(baselineCount) || 0);
  const normalizedThresholdPercent = Math.max(0, Math.min(100, Number(thresholdPercent) || 0));
  const percentage = normalizedBaselineCount === 0
    ? 0
    : Number(((paths.length / normalizedBaselineCount) * 100).toFixed(2));

  return {
    blocked: normalizedBaselineCount > 0 && percentage > normalizedThresholdPercent && !hasOverride,
    percentage,
  };
}

/**
 * Chunks an array of file upload payloads respecting both item count and cumulative byte size.
 *
 * @param {Array<any>} files
 * @param {number} maxCount Maximum files per batch (default 50)
 * @param {number} maxBytes Maximum cumulative bytes per batch (default 8MB)
 * @returns {Array<Array<any>>}
 */
function chunkFilesForBatchUpload(files, maxCount = 50, maxBytes = 8 * 1024 * 1024) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const chunks = [];
  let currentChunk = [];
  let currentBytes = 0;

  for (const item of files) {
    const itemBytes = Number(
      item?.buffer?.byteLength ??
      item?.byteLength ??
      item?.size ??
      0
    );

    if (
      currentChunk.length > 0 &&
      (currentChunk.length >= maxCount || currentBytes + itemBytes > maxBytes)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }

    currentChunk.push(item);
    currentBytes += itemBytes;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export {
  deletionGuard,
  shouldSyncPath,
  isObsidianPathAllowed,
  isPluginSafeForPlatform,
  chunkFilesForBatchUpload,
};

export default {
  deletionGuard,
  shouldSyncPath,
  isObsidianPathAllowed,
  isPluginSafeForPlatform,
  chunkFilesForBatchUpload,
};
