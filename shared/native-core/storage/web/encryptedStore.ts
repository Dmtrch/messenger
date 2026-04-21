import { get, set, del, type UseStore } from '../../../../client/node_modules/idb-keyval/dist/index.js';
import { getActiveVaultKey, encryptBytes, decryptBytes } from '../../crypto/cryptoVault';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptedSet<T>(key: string, value: T, store: UseStore): Promise<void> {
  const vaultKey = getActiveVaultKey();
  const bytes = encoder.encode(JSON.stringify(value));

  if (vaultKey !== null) {
    const ciphertext = await encryptBytes(vaultKey, bytes);
    await set(key, ciphertext, store);
  } else {
    await set(key, JSON.stringify(value), store);
  }
}

export async function encryptedGet<T>(key: string, store: UseStore): Promise<T | undefined> {
  const raw = await get<unknown>(key, store);

  if (raw === undefined) {
    return undefined;
  }

  if (raw instanceof Uint8Array) {
    const vaultKey = getActiveVaultKey();
    if (vaultKey === null) {
      return undefined;
    }
    try {
      const plaintext = await decryptBytes(vaultKey, raw);
      return JSON.parse(decoder.decode(plaintext)) as T;
    } catch {
      return undefined;
    }
  }

  return raw as T;
}

export async function encryptedDel(key: string, store: UseStore): Promise<void> {
  await del(key, store);
}
