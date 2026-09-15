import * as Y from 'yjs';
import { Observable } from 'lib0/observable';

export class SynkkAwareness extends Observable<string> {
  doc: Y.Doc;
  clientID: number;
  states: Map<number, Record<string, unknown>>;
  meta: Map<number, { clock: number; lastUpdated: number }>;
  constructor(doc: Y.Doc);
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  destroy(): void;
}

export interface YjsTransport {
  fetchUpdates(afterSequence: number): Promise<Array<Record<string, unknown>>>;
  sendUpdate(update: Record<string, unknown>): Promise<void>;
  appendUpdate?(update: Record<string, unknown>): Promise<void>;
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

  constructor(options: SynkkYjsProviderOptions);

  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;
  checkpoint(): Promise<unknown>;
}
