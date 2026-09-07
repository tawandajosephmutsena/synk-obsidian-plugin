import { SynkkApiClient } from './apiClient';
import { RagQueryResponse, RagSearchResult, RagStatusResponse } from './types';

export class RagClient {
  constructor(private apiClient: SynkkApiClient) {}

  public async query(vaultSlug: string, query: string, expandGraph: boolean = true): Promise<RagQueryResponse> {
    return this.apiClient.ragQuery(vaultSlug, query, expandGraph);
  }

  public async search(vaultSlug: string, query: string, limit: number = 5): Promise<RagSearchResult[]> {
    const res = await this.apiClient.ragSearch(vaultSlug, query, limit);
    return res.results || [];
  }

  public async reindex(vaultSlug: string, force: boolean = false): Promise<any> {
    return this.apiClient.ragIndex(vaultSlug, force);
  }

  public async status(vaultSlug: string): Promise<RagStatusResponse> {
    return this.apiClient.ragStatus(vaultSlug);
  }
}
