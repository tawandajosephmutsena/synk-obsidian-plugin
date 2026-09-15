import { App, Notice, TFile } from 'obsidian';
import { SynkkApiClient } from './apiClient';

export interface GhostStubMetadata {
  path: string;
  size: number;
  mime: string;
  sha256?: string;
}

export class GhostFileManager {
  public static STUB_REGEX = /<!-- synkk:ghost\s+path="([^"]+)"\s+size="(\d+)"\s+mime="([^"]+)"(?:\s+sha256="([^"]+)")?\s*-->/;

  public static isGhostStub(content: string): boolean {
    return this.STUB_REGEX.test(content);
  }

  public static parseGhostStub(content: string): GhostStubMetadata | null {
    const match = content.match(this.STUB_REGEX);
    if (!match) return null;

    return {
      path: match[1],
      size: parseInt(match[2], 10),
      mime: match[3],
      sha256: match[4] || undefined,
    };
  }

  public static generateStub(meta: GhostStubMetadata): string {
    const formattedSize = (meta.size / (1024 * 1024)).toFixed(1);
    const shaAttr = meta.sha256 ? ` sha256="${meta.sha256}"` : '';

    return `<!-- synkk:ghost path="${meta.path}" size="${meta.size}" mime="${meta.mime}"${shaAttr} -->
> [!NOTE] 👻 Synkk Ghost Attachment
> **File:** \`${meta.path}\` (${formattedSize} MB)
> **Status:** Lightweight stub on this device. Content will stream on demand.
>
> Use the command palette: **Synkk: Hydrate current ghost file** to download the full media binary.
`;
  }

  /**
   * Hydrates a ghost file by downloading the original binary from Synkk and replacing the stub.
   */
  public static async hydrateFile(
    app: App,
    api: SynkkApiClient,
    vaultSlug: string,
    file: TFile | string
  ): Promise<boolean> {
    const filePath = typeof file === 'string' ? file : file.path;

    try {
      new Notice(`Synkk: Hydrating ghost file "${filePath}"...`);

      const binary = await api.downloadFile(vaultSlug, filePath);
      await app.vault.adapter.writeBinary(filePath, binary);

      new Notice(`Synkk: "${filePath}" hydrated successfully!`);
      return true;
    } catch (err: unknown) {
      console.error(`Failed to hydrate ghost file ${filePath}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Synkk: Failed to hydrate "${filePath}": ${msg}`);
      return false;
    }
  }

  /**
   * Dehydrates a local attachment into a ghost stub to free local device storage.
   */
  public static async dehydrateFile(
    app: App,
    api: SynkkApiClient,
    vaultSlug: string,
    filePath: string
  ): Promise<boolean> {
    try {
      const exists = await app.vault.adapter.exists(filePath);
      if (!exists) {
        new Notice(`Synkk: File "${filePath}" not found.`);
        return false;
      }

      const stat = await app.vault.adapter.stat(filePath);
      const size = stat?.size || 0;

      // Ask server to dehydrate
      await api.dehydrateFile(vaultSlug, filePath);

      // Replace local file with ghost stub
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const mime = ext === 'mp4' ? 'video/mp4' : ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';

      const stub = this.generateStub({
        path: filePath,
        size,
        mime,
      });

      await app.vault.adapter.write(filePath, stub);
      new Notice(`Synkk: Dehydrated "${filePath}" to ghost stub (${(size / (1024 * 1024)).toFixed(1)} MB freed).`);
      return true;
    } catch (err: unknown) {
      console.error(`Failed to dehydrate file ${filePath}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Synkk: Dehydration failed: ${msg}`);
      return false;
    }
  }
}
