import assert from 'node:assert/strict';
import test from 'node:test';

function uint8ToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToUint8(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(passphrase, saltHex) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: hexToUint8(saltHex),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, key) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const encBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return {
    ciphertext: new Uint8Array(encBuf),
    ivHex: uint8ToHex(iv),
  };
}

async function decryptData(ciphertext, ivHex, key) {
  const iv = hexToUint8(ivHex);
  const decBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new Uint8Array(decBuf);
}

test('derives identical key from same passphrase and salt', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const key1 = await deriveKey('correct-horse-battery', salt);
  const key2 = await deriveKey('correct-horse-battery', salt);

  const raw = new TextEncoder().encode('Hello World Zero Knowledge');
  const enc = await encryptData(raw, key1);
  const dec = await decryptData(enc.ciphertext, enc.ivHex, key2);

  assert.equal(new TextDecoder().decode(dec), 'Hello World Zero Knowledge');
});

test('fails to decrypt ciphertext with wrong passphrase', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const correctKey = await deriveKey('correct-passphrase', salt);
  const wrongKey = await deriveKey('wrong-passphrase', salt);

  const raw = new TextEncoder().encode('Secret financial records');
  const enc = await encryptData(raw, correctKey);

  await assert.rejects(async () => {
    await decryptData(enc.ciphertext, enc.ivHex, wrongKey);
  });
});
