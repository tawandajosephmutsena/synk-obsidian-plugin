const fs = require('fs');
let code = fs.readFileSync('src/preflightScanner.ts', 'utf8');

code = code.replace(
  /export interface PreflightScanOptions \{/,
  "export interface PreflightScanOptions {\n  configDir?: string;"
);

code = code.replace(
  /export function categorizeFile\(path: string, configDir: string = '.obsidian'\): FileCategory \{/,
  "export function categorizeFile(path: string, configDir: string): FileCategory {"
);

code = code.replace(
  /const category = categorizeFile\(file.path\);/,
  "const category = categorizeFile(file.path, options.configDir || '.obsidian');"
);

code = code.replace(
  /return scanVaultFiles\(files, options\);/,
  "options.configDir = options.configDir || app.vault.configDir;\n  return scanVaultFiles(files, options);"
);

fs.writeFileSync('src/preflightScanner.ts', code);
