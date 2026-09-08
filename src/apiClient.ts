import { Platform, requestUrl, RequestUrlParam } from 'obsidian';
import { ManifestResponse, RagQueryResponse, RagSearchResult, RagStatusResponse, RemoteVault, UploadResponse, VerifyAuthResponse } from './types';

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
      'X-Synkk-Protocol': '2',
    };
  }

  private async request(params: RequestUrlParam): Promise<any> {
    const res = await requestUrl({
      ...params,
      throw: false,
    });

    if (res.status === 426) {
      const data = res.json;
      const message = data?.message || 'Synkk Protocol Upgrade Required: Please update your Synkk plugin to protocol version 2.';
      const err: any = new Error(message);
      err.status = 426;
      err.isProtocolUpgradeRequired = true;
      throw err;
    }

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

  public async downloadFile(vaultSlug: string, path: string, asGhost: boolean = false): Promise<ArrayBuffer> {
    const ghostParam = asGhost ? '&ghost=1' : '';
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/download?path=${encodeURIComponent(path)}${ghostParam}`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to download ${path}: HTTP ${res.status}`);
    }

    return res.arrayBuffer;
  }

  public async downloadFileWithHeaders(
    vaultSlug: string,
    path: string,
    asGhost: boolean = false
  ): Promise<{ data: ArrayBuffer; headers: Record<string, string> }> {
    const ghostParam = asGhost ? '&ghost=1' : '';
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/download?path=${encodeURIComponent(path)}${ghostParam}`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to download ${path}: HTTP ${res.status}`);
    }

    return {
      data: res.arrayBuffer,
      headers: res.headers || {},
    };
  }

  public async uploadFile(
    vaultSlug: string,
    path: string,
    contentBase64: string,
    baseVersion: number,
    extraParams?: {
      is_encrypted?: boolean;
      encryption_iv?: string;
      encryption_tag?: string;
      is_ghost?: boolean;
      original_size?: number;
    }
  ): Promise<UploadResponse> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/upload`;
    const payload: any = {
      path,
      content_base64: contentBase64,
      base_version: baseVersion,
    };

    if (extraParams?.is_encrypted) {
      payload.encrypted = true;
      payload.is_encrypted = true;
      payload.iv = extraParams.encryption_iv;
      payload.encryption_iv = extraParams.encryption_iv;
      payload.tag = extraParams.encryption_tag;
      payload.encryption_tag = extraParams.encryption_tag;
      payload.format_version = 2;
    }

    if (extraParams?.is_ghost) {
      payload.is_ghost = true;
      payload.original_size = extraParams.original_size;
    }

    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Upload failed for ${path}: HTTP ${res.status} - ${res.text}`);
    }

    return res.json as UploadResponse;
  }

  public async hydrateFile(vaultSlug: string, path: string): Promise<any> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/files/hydrate`;
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
      throw new Error(`Failed to hydrate ${path}: HTTP ${res.status}`);
    }

    return res.json;
  }

  public async dehydrateFile(vaultSlug: string, path: string): Promise<any> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/files/dehydrate`;
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
      throw new Error(`Failed to dehydrate ${path}: HTTP ${res.status}`);
    }

    return res.json;
  }

  public async enableE2ee(vaultSlug: string, salt: string, testCipher: string): Promise<any> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/e2ee/enable`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        salt,
        test_cipher: testCipher,
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to enable E2EE: HTTP ${res.status}`);
    }

    return res.json;
  }

  public async getE2eeStatus(vaultSlug: string): Promise<{ is_e2ee: boolean; salt: string | null; has_test_cipher: boolean }> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/e2ee/status`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to get E2EE status: HTTP ${res.status}`);
    }

    return res.json;
  }

  public async getTransportStatus(vaultSlug: string): Promise<any> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/transport/status`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`Failed to get transport status: HTTP ${res.status}`);
    }

    return res.json;
  }

  public static async exchangePairing(
    serverUrl: string,
    sessionId: string,
    deviceName: string,
    platform: string = 'ios'
  ): Promise<{
    status: string;
    plain_token: string;
    device_id: number;
    server_url: string;
    team_slug: string;
    vault_slug?: string;
    access_scope?: string;
    user?: { id: number; name: string; email: string };
    team?: { id: number; name: string; slug: string };
  }> {
    const cleanServerUrl = serverUrl.replace(/\/+$/, '');
    const url = `${cleanServerUrl}/pairing/exchange`;
    const res = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Synkk-Protocol': '2',
      },
      body: JSON.stringify({
        session: sessionId,
        device_name: deviceName,
        platform,
      }),
      throw: false,
    });

    if (res.status === 410) {
      const data = res.json;
      const message = data?.message || data?.error || 'Pairing session has expired or has already been used. Please generate a new QR code.';
      const err: any = new Error(message);
      err.status = 410;
      err.isExpiredOrConsumed = true;
      throw err;
    }

    if (res.status !== 200) {
      const data = res.json;
      const message = data?.message || data?.error || res.text || `Pairing exchange failed (HTTP ${res.status})`;
      const err: any = new Error(message);
      err.status = res.status;
      throw err;
    }

    return res.json;
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
    items: Array<{
      action?: 'upload' | 'delete';
      path: string;
      content_base64?: string;
      base_version?: number;
      is_encrypted?: boolean;
      encryption_iv?: string;
      encryption_tag?: string;
      is_ghost?: boolean;
      original_size?: number;
      mime_type?: string;
    }>
  ): Promise<{ status: string; latest_version: number; summary: any; items: any[] }> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/batch-sync`;
    const normalizedItems = items.map(item => {
      if (item.is_encrypted) {
        return {
          ...item,
          encrypted: true,
          iv: item.encryption_iv,
          tag: item.encryption_tag,
          format_version: 2,
        };
      }
      return item;
    });

    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: normalizedItems, items: normalizedItems }),
    });

    if (res.status !== 200) {
      throw new Error(`Batch sync failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json;
  }

  public async ragQuery(
    vaultSlug: string,
    query: string,
    expandGraph: boolean = true,
    maxCitations: number = 4
  ): Promise<RagQueryResponse> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/rag/query`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        expand_graph: expandGraph,
        max_citations: maxCitations,
      }),
    });

    if (res.status !== 200) {
      throw new Error(`RAG query failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json as RagQueryResponse;
  }

  public async ragSearch(
    vaultSlug: string,
    query: string,
    limit: number = 5
  ): Promise<{ status: string; query: string; count: number; results: RagSearchResult[] }> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/rag/search`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
      }),
    });

    if (res.status !== 200) {
      throw new Error(`RAG search failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json;
  }

  public async ragIndex(
    vaultSlug: string,
    force: boolean = false
  ): Promise<{ status: string; files_indexed: number; chunks_count: number; duration_ms: number }> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/rag/index`;
    const res = await this.request({
      url,
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force }),
    });

    if (res.status !== 200) {
      throw new Error(`RAG index failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json;
  }

  public async ragStatus(vaultSlug: string): Promise<RagStatusResponse> {
    const url = `${this.serverUrl}/vaults/${encodeURIComponent(vaultSlug)}/rag/status`;
    const res = await this.request({
      url,
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (res.status !== 200) {
      throw new Error(`RAG status check failed: HTTP ${res.status} - ${res.text}`);
    }

    return res.json as RagStatusResponse;
  }
}
