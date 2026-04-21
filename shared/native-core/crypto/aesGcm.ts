/**
 * aesGcm.ts — Portable AES-256-GCM encrypt/decrypt via WebCrypto.
 * Works in browser and Node.js 18+. No external dependencies.
 *
 * Wire format: nonce (12 bytes) || ciphertext || auth_tag (16 bytes)
 */

const NONCE_LENGTH = 12

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    raw as unknown as Uint8Array<ArrayBuffer>,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypts plaintext with the given 32-byte AES-256 key.
 * Returns combined buffer: nonce (12 bytes) + ciphertext + auth_tag (16 bytes).
 */
export async function encryptAesGcm(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = new Uint8Array(NONCE_LENGTH)
  globalThis.crypto.getRandomValues(nonce)
  const cryptoKey = await importKey(key)
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as Uint8Array<ArrayBuffer> },
    cryptoKey,
    plaintext as unknown as Uint8Array<ArrayBuffer>,
  )
  const result = new Uint8Array(NONCE_LENGTH + ciphertext.byteLength)
  result.set(nonce, 0)
  result.set(new Uint8Array(ciphertext), NONCE_LENGTH)
  return result
}

/**
 * Decrypts a combined buffer produced by encryptAesGcm.
 * Expects format: nonce (12 bytes) || ciphertext + auth_tag.
 */
export async function decryptAesGcm(
  key: Uint8Array,
  combined: Uint8Array,
): Promise<Uint8Array> {
  const nonce = combined.slice(0, NONCE_LENGTH)
  const ciphertext = combined.slice(NONCE_LENGTH)
  const cryptoKey = await importKey(key)
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as Uint8Array<ArrayBuffer> },
    cryptoKey,
    ciphertext as unknown as Uint8Array<ArrayBuffer>,
  )
  return new Uint8Array(plaintext)
}
