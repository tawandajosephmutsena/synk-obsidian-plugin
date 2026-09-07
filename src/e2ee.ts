/**
 * Synkk Zero-Knowledge End-to-End Encryption (E2EE)
 *
 * Implements client-side AES-256-GCM encryption with PBKDF2 key derivation (100,000 rounds).
 * Plaintext notes and passphrases never leave the client device unencrypted.
 */

export function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToUint8(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export class E2eeVaultEngine {
  private key: CryptoKey | null = null;
  private saltHex: string = '';

  public static generateSalt(): string {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    return uint8ToHex(saltBytes);
  }

  public async initialize(passphrase: string, saltHex: string): Promise<void> {
    if (!passphrase || passphrase.trim().length === 0) {
      this.key = null;
      this.saltHex = '';
      return;
    }

    this.saltHex = saltHex;
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const saltBytes = hexToUint8(saltHex);

    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  public isReady(): boolean {
    return this.key !== null;
  }

  public async encrypt(data: Uint8Array | ArrayBuffer): Promise<{
    ciphertext: Uint8Array;
    ivHex: string;
    tagHex: string;
  }> {
    if (!this.key) {
      throw new Error('E2EE key is not initialized. Please configure vault passphrase.');
    }

    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const encryptedBuf = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      this.key,
      raw
    );

    const fullEncrypted = new Uint8Array(encryptedBuf);
    // In WebCrypto AES-GCM, the last 16 bytes are the authentication tag
    const tagLength = 16;
    const cipherLength = fullEncrypted.length - tagLength;
    const ciphertext = fullEncrypted.slice(0, cipherLength);
    const tag = fullEncrypted.slice(cipherLength);

    return {
      ciphertext: fullEncrypted,
      ivHex: uint8ToHex(iv),
      tagHex: uint8ToHex(tag),
    };
  }

  public async decrypt(
    ciphertext: Uint8Array | ArrayBuffer,
    ivHex: string,
    tagHex?: string
  ): Promise<Uint8Array> {
    if (!this.key) {
      throw new Error('E2EE key is not initialized. Please configure vault passphrase.');
    }

    const iv = hexToUint8(ivHex);
    let combined: Uint8Array;
    const cipherBytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);

    if (tagHex && tagHex.length === 32) {
      const tagBytes = hexToUint8(tagHex);
      if (cipherBytes.length >= 16) {
        const last16Hex = uint8ToHex(cipherBytes.slice(cipherBytes.length - 16));
        if (last16Hex.toLowerCase() === tagHex.toLowerCase()) {
          combined = cipherBytes;
        } else {
          combined = new Uint8Array(cipherBytes.length + tagBytes.length);
          combined.set(cipherBytes, 0);
          combined.set(tagBytes, cipherBytes.length);
        }
      } else {
        combined = new Uint8Array(cipherBytes.length + tagBytes.length);
        combined.set(cipherBytes, 0);
        combined.set(tagBytes, cipherBytes.length);
      }
    } else {
      combined = cipherBytes;
    }

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      this.key,
      combined
    );

    return new Uint8Array(decrypted);
  }

  public async encryptText(text: string): Promise<{
    ciphertextBase64: string;
    ivHex: string;
    tagHex: string;
  }> {
    const enc = new TextEncoder();
    const result = await this.encrypt(enc.encode(text));
    const binary = String.fromCharCode(...result.ciphertext);
    const base64 = btoa(binary);
    return {
      ciphertextBase64: base64,
      ivHex: result.ivHex,
      tagHex: result.tagHex,
    };
  }

  public async decryptText(
    ciphertextBase64: string,
    ivHex: string,
    tagHex?: string
  ): Promise<string> {
    const binaryStr = atob(ciphertextBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const decryptedBytes = await this.decrypt(bytes, ivHex, tagHex);
    const dec = new TextDecoder();
    return dec.decode(decryptedBytes);
  }

  public async createVerificationCipher(): Promise<string> {
    const testPlaintext = 'synkk-e2ee-verify-token-v1';
    const res = await this.encryptText(testPlaintext);
    return JSON.stringify(res);
  }

  public async verifyStoredCipher(cipherJson: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(cipherJson);
      const decrypted = await this.decryptText(parsed.ciphertextBase64, parsed.ivHex, parsed.tagHex);
      return decrypted === 'synkk-e2ee-verify-token-v1';
    } catch {
      return false;
    }
  }
}
