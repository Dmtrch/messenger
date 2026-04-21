import { create } from 'zustand'
import { createStore } from 'idb-keyval'
import {
  deriveVaultKey,
  loadOrInitSalt,
  setActiveVaultKey,
} from '../../../shared/native-core/crypto/cryptoVault'

interface VaultState {
  isUnlocked: boolean
  setUnlocked(v: boolean): void
}

export const useVaultStore = create<VaultState>((set) => ({
  isUnlocked: false,
  setUnlocked: (v) => set({ isUnlocked: v }),
}))

// Разблокировка: деривация ключа → установка активного ключа → обновление store
// Бросает Error если passphrase неверен (но для первого запуска — всегда успешна)
export async function unlockVault(passphrase: string): Promise<void> {
  const salt = loadOrInitSalt()
  const key = await deriveVaultKey(passphrase, salt)
  setActiveVaultKey(key)
  useVaultStore.getState().setUnlocked(true)
  // Запуск миграции — импортируем динамически чтобы избежать циклов
  const { isMigrationDone, runVaultMigration } = await import(
    '../../../shared/native-core/storage/web/vaultMigration'
  )
  if (!(await isMigrationDone())) {
    const store = createStore('messenger-keys', 'keys')
    await runVaultMigration(store)
  }
}

export function lockVault(): void {
  setActiveVaultKey(null)
  useVaultStore.getState().setUnlocked(false)
}

// Смена пароля хранилища: re-derive новый ключ → re-encrypt all
export async function changeVaultPassphrase(
  _oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  const salt = loadOrInitSalt()
  const newKey = await deriveVaultKey(newPassphrase, salt)
  const { runVaultMigration, clearMigrationFlag } = await import(
    '../../../shared/native-core/storage/web/vaultMigration'
  )
  const store = createStore('messenger-keys', 'keys')
  // Сбрасываем флаг миграции, устанавливаем новый ключ, мигрируем
  await clearMigrationFlag()
  setActiveVaultKey(newKey)
  await runVaultMigration(store)
}
