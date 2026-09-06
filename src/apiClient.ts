import { Platform, requestUrl, RequestUrlParam } from 'obsidian';
import { ManifestResponse, RemoteVault, UploadResponse, VerifyAuthResponse } from './types';

export class SynkkApiClient {
  private serverUrl: string;
  private token: string;

  constructor(serverUrl: string, token: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  public updateConfig(serverUrl: string, token: string): void {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  private getPlatform(): string {
    if (Platform.isIosApp) return 'ios';
    if (Platform.isAndroidApp) return 'android';
    if (Platform.isMacOS) return 'mac';
    if (Platform.isWin) return 'windows';
    if (Platform.isLinux) return 'linux';
    return 'unknown';
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/json',
      'X-Client-Platform': this.getPlatform(),
    };
  }

  private async request(params: RequestUrlParam): Promise<any> {
    const res = await requestUrl({
      ...params,
      throw: false,
    });

    if (res.status === 410) {
      const err: any = new Error('Synkk Security: This device token was remotely wiped by an enterprise administrator.');
      err.status = 410;
      err.isRemoteWipe = true;
      throw err;
    }

    if (res.status === 401) {
      const data = res.json;
      const message = data?.message || 'Authentication failed: Invalid or revoked device token.';
      const err: any = new Error(message);
      err.status = 401;
      throw err;
    }

    if (res.status === 403) {
      const data = res.json;
      const message = data?.message || 'Permission denied: Action or IP address not allowed.';
      const err: any = new Error(message);
      err.status = 403;
      throw err;
    }

    return res;
  }

  public async verifyAuth(): Promise<VerifyAuthResponse> {
    const url = `${this.serverUrl}/auth/verify`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Authentication failed (HTTP ${res.status}): ${res.text}`);
    }

    return res.json as VerifyAuthResponse;
  }

  public async getVaults(): Promise<RemoteVault[]> {
    const url = `${this.serverUrl}/vaults`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to fetch vaults: HTTP ${res.status}`);
    }

    const data = res.json;
    return (data.vaults || []) as RemoteVault[];
  }

  public async getManifest(vaultSlug: string, sinceVersion: number = 0): Promise<ManifestResponse> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/manifest?since_version=${sinceVersion}`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to fetch manifest: HTTP ${res.status}`);
    }

    return res.json as ManifestResponse;
  }

  public async downloadFile(vaultSlug: string, path: string): Promise<ArrayBuffer> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/download?path=${encodeURIComponent(path)}`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'X-Client-Platform': this.getPlatform(),
      },
    });

    if (res.status !== 200) {
      throw new Error(`Failed to download ${path}: HTTP ${res.status}`);
    }

    return res.arrayBuffer;
  }

  public async uploadFile(
    vaultSlug: string,
    path: string,
    contentBase64: string,
    baseVersion: number
  ): Promise<UploadResponse> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/upload`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path,
        content_base64: contentBase64,
        base_version: baseVersion,
      }),
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Upload failed for ${path}: HTTP ${res.status} - ${res.text}`);
    }

    return res.json as UploadResponse;
  }

  public async deleteFile(vaultSlug: string, path: string): Promise<void> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/delete`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to delete ${path}: HTTP ${res.status}`);
    }
  }

  public async batchSync(
    vaultSlug: string,
    items: Array<{ action?: 'upload' | 'delete'; path: string; content_base64?: string; base_version?: number }>
  ): Promise<{ status: string; latest_version: number; summary: any; items: any[] }> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/batch-sync`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });

    if (res.status !== 200) {
      throw new Error(`Batch sync failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json;
  }
}
