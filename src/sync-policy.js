const alwaysExcludedPrefixes = ['.git', '.trash', '.synkk'];

const alwaysExcludedObsidianPaths = [
  '.obsidian/synkk-state.json',
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/hotkeys.json',
  '.obsidian/cache',
];

function normalizePath(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
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

function isObsidianPathAllowed(path, settings) {
  if (alwaysExcludedObsidianPaths.some((prefix) => matchesPrefix(path, prefix))) {
    return false;
  }

  if (path === '.obsidian/community-plugins.json') {
    return settings.syncPluginList === true;
  }

  if (matchesPrefix(path, '.obsidian/snippets')) {
    return settings.syncSnippets === true;
  }

  if (matchesPrefix(path, '.obsidian/plugins')) {
    return settings.syncPluginData === true;
  }

  return false;
}

function shouldSyncPath(path, settings) {
  const normalizedPath = normalizePath(path);

  if (!normalizedPath || normalizedPath.endsWith('.DS_Store') || normalizedPath.includes('/.DS_Store')) {
    return false;
  }

  if (alwaysExcludedPrefixes.some((prefix) => matchesPrefix(normalizedPath, prefix))) {
    return false;
  }

  if (matchesPrefix(normalizedPath, '.obsidian') && !isObsidianPathAllowed(normalizedPath, settings)) {
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

module.exports = { deletionGuard, shouldSyncPath };
