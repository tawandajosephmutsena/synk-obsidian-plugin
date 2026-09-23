import * as Y from 'yjs';

export class SynkkAwareness {
  doc: Y.Doc;
  clientID: number;
  states: Map<number, Record<string, unknown>>;
  meta: Map<number, { clock: number; lastUpdated: number }>;
  constructor(doc: Y.Doc);
  on(name: string, f: (...args: unknown[]) => void): void;
  once(name: string, f: (...args: unknown[]) => void): void;
  off(name: string, f: (...args: unknown[]) => void): void;
  emit(name: string, args: unknown[]): void;
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  destroy(): void;
}

export interface YjsTransport {
  fetchUpdates(afterSequence: number): Promise<{ document_id?: string | number; updates?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null | void>;
  sendUpdate(update: Record<string, unknown>): Promise<unknown>;
  appendUpdate?(update: Record<string, unknown>): Promise<unknown>;
  checkpoint?(payload: {
    checkpoint_snapshot?: string;
    is_encrypted?: boolean;
    encryption_iv?: string;
    encryption_tag?: string;
  }): Promise<unknown>;
  fetchSnapshot?(): Promise<{ sequence: number; updateBase64: string } | null>;
}

export interface SynkkYjsProviderOptions {
  doc: Y.Doc;
  vaultId: string | number;
  documentId?: string | number | null;
  path?: string;
  cryptoKey?: CryptoKey | null;
  e2eeEngine?: unknown;
  transport?: YjsTransport | null;
  echo?: unknown;
  awareness?: SynkkAwareness | null;
}

export class SynkkYjsProvider {
  doc: Y.Doc;
  vaultId: string | number;
  documentId: string | number | null;
  path: string;
  cryptoKey: CryptoKey | null;
  connected: boolean;
  awareness: SynkkAwareness | null;
  latestSequence: number;
  providerOrigin: object;

  constructor(options: SynkkYjsProviderOptions);

  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;
  checkpoint(): Promise<unknown>;
}
