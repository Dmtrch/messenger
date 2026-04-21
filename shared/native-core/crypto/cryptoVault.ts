/**
 * cryptoVault.ts — WebCrypto vault encryption for IDB storage.
 * Pure WebCrypto API only. No React, no Zustand, no third-party libs.
 */

const SALT_STORAGE_KEY = 'vault_salt_v1';
const NONCE_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 600_000;

// ── Salt management ────────────────────────────────────────────────────────────

export function generateVaultSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

export function hasSaltStored(): boolean {
  return localStorage.getItem(SALT_STORAGE_KEY) !== null;
}

export function loadOrInitSalt(): Uint8Array {
  const stored = localStorage.getItem(SALT_STORAGE_KEY);
  if (stored !== null) {
    const binary = atob(stored);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const salt = generateVaultSalt();
  saveSalt(salt);
  return salt;
}

export function saveSalt(salt: Uint8Array): void {
  let binary = '';
  for (let i = 0; i < salt.length; i++) {
    binary += String.fromCharCode(salt[i]);
  }
  localStorage.setItem(SALT_STORAGE_KEY, btoa(binary));
}

// ── Key derivation — PBKDF2-SHA-256 → AES-256-GCM ────────────────────────────

export async function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const rawKey = new TextEncoder().encode(passphrase);
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as Uint8Array<ArrayBuffer>,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Encrypt / Decrypt — AES-256-GCM ──────────────────────────────────────────

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = new Uint8Array(NONCE_LENGTH);
  globalThis.crypto.getRandomValues(nonce);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as Uint8Array<ArrayBuffer> },
    key,
    plaintext as unknown as Uint8Array<ArrayBuffer>,
  );
  const result = new Uint8Array(NONCE_LENGTH + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), NONCE_LENGTH);
  return result;
}

export async function decryptBytes(
  key: CryptoKey,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = ciphertext.slice(0, NONCE_LENGTH);
  const data = ciphertext.slice(NONCE_LENGTH);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data,
  );
  return new Uint8Array(plaintext);
}

// ── Module-level active vault key (singleton) ─────────────────────────────────

let _activeVaultKey: CryptoKey | null = null;

export function getActiveVaultKey(): CryptoKey | null {
  return _activeVaultKey;
}

export function setActiveVaultKey(key: CryptoKey | null): void {
  _activeVaultKey = key;
}

export function isVaultKeySet(): boolean {
  return _activeVaultKey !== null;
}
