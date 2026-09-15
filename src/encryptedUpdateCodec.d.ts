export function uint8ToHex(bytes: Uint8Array | number[]): string;
export function hexToUint8(hex: string): Uint8Array;
export function uint8ToBase64(bytes: Uint8Array): string;
export function base64ToUint8(base64: string): Uint8Array;
export function sha256Hex(bytes: Uint8Array): Promise<string>;
export function encodeAad(options: {
  vaultId: string | number;
  documentId: string | number;
  purpose?: string;
  formatVersion?: number;
}): Uint8Array;

export function encodeEncryptedUpdate(
  plaintextUpdate: Uint8Array | ArrayBuffer,
  cryptoKey: CryptoKey,
  options: {
    vaultId: string | number;
    documentId: string | number;
    purpose?: string;
    formatVersion?: number;
  }
): Promise<{
  ciphertextBase64: string;
  ivHex: string;
  tagHex: string;
  payloadSha256: string;
  formatVersion: number;
}>;

export function decodeEncryptedUpdate(
  envelope: {
    ciphertextBase64: string;
    ivHex: string;
    tagHex: string;
    formatVersion?: number;
  },
  cryptoKey: CryptoKey,
  options: {
    vaultId: string | number;
    documentId: string | number;
    purpose?: string;
  }
): Promise<Uint8Array>;
