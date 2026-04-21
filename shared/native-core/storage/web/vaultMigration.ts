import { get, keys, type UseStore } from '../../../../client/node_modules/idb-keyval/dist/index.js';
import { encryptedSet } from './encryptedStore';
import { isVaultKeySet } from '../../crypto/cryptoVault';

const MIGRATION_FLAG_KEY = 'vault_migration_v1';

export function isMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_FLAG_KEY) === 'done';
}

export function clearMigrationFlag(): void {
  localStorage.removeItem(MIGRATION_FLAG_KEY);
}

function markMigrationDone(): void {
  localStorage.setItem(MIGRATION_FLAG_KEY, 'done');
}

export async function runVaultMigration(store: UseStore): Promise<void> {
  if (!isVaultKeySet()) {
    return;
  }

  const allKeys = await keys(store);

  for (const k of allKeys) {
    try {
      const raw = await get<unknown>(k, store);

      if (raw instanceof Uint8Array) {
        continue;
      }

      if (raw == null) {
        continue;
      }

      await encryptedSet(String(k), raw, store);
    } catch (err) {
      console.warn(`[vaultMigration] Failed to migrate key "${String(k)}":`, err);
    }
  }

  markMigrationDone();
}
