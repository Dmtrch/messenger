/**
 * Локальное хранилище приватных ключей в IndexedDB.
 * Использует idb-keyval — минималистичный key-value поверх IndexedDB.
 *
 * Приватные ключи НИКОГДА не покидают устройство.
 * Все операции — асинхронные.
 */

import { get, set, del, createStore } from 'idb-keyval'

const keyStore = createStore('messenger-keys', 'keys')

/** Identity Key Pair (Ed25519) */
export interface IdentityKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

/** X25519 Key Pair (для DH операций) */
export interface DHKeyPair {
  id: number
  publicKey: Uint8Array
  privateKey: Uint8Array
}

// ── Identity Key ──────────────────────────────────────────

export async function saveIdentityKey(pair: IdentityKeyPair): Promise<void> {
  await set('identity_key', pair, keyStore)
}

export async function loadIdentityKey(): Promise<IdentityKeyPair | undefined> {
  return get<IdentityKeyPair>('identity_key', keyStore)
}

// ── Signed PreKey ─────────────────────────────────────────

export async function saveSignedPreKey(pair: DHKeyPair): Promise<void> {
  await set('signed_prekey', pair, keyStore)
}

export async function loadSignedPreKey(): Promise<DHKeyPair | undefined> {
  return get<DHKeyPair>('signed_prekey', keyStore)
}

// ── One-Time PreKeys ──────────────────────────────────────

export async function saveOneTimePreKeys(keys: DHKeyPair[]): Promise<void> {
  await set('one_time_prekeys', keys, keyStore)
}

export async function loadOneTimePreKeys(): Promise<DHKeyPair[]> {
  return (await get<DHKeyPair[]>('one_time_prekeys', keyStore)) ?? []
}

export async function consumeOneTimePreKey(id: number): Promise<DHKeyPair | undefined> {
  const keys = await loadOneTimePreKeys()
  const key = keys.find((k) => k.id === id)
  if (key) {
    await saveOneTimePreKeys(keys.filter((k) => k.id !== id))
  }
  return key
}

// ── Double Ratchet session states ─────────────────────────

export interface RatchetSessionData {
  chatId: string
  state: Uint8Array   // сериализованное состояние рэтчета
  updatedAt: number
}

export async function saveRatchetSession(data: RatchetSessionData): Promise<void> {
  await set(`ratchet:${data.chatId}`, data, keyStore)
}

export async function loadRatchetSession(chatId: string): Promise<RatchetSessionData | undefined> {
  return get<RatchetSessionData>(`ratchet:${chatId}`, keyStore)
}

export async function deleteRatchetSession(chatId: string): Promise<void> {
  await del(`ratchet:${chatId}`, keyStore)
}

// ── Push subscription ─────────────────────────────────────

export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await set('push_subscription', sub, keyStore)
}

export async function loadPushSubscription(): Promise<PushSubscriptionJSON | undefined> {
  return get<PushSubscriptionJSON>('push_subscription', keyStore)
}
