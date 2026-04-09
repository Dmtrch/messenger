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

/**
 * Добавить новые OPK к существующим без перезаписи всего массива.
 * IDs новых ключей = max(existing) + 1..N.
 */
export async function appendOneTimePreKeys(newKeys: Omit<DHKeyPair, 'id'>[]): Promise<DHKeyPair[]> {
  const existing = await loadOneTimePreKeys()
  const maxId = existing.reduce((m, k) => Math.max(m, k.id), 0)
  const keysWithIds: DHKeyPair[] = newKeys.map((k, i) => ({ ...k, id: maxId + 1 + i }))
  await saveOneTimePreKeys([...existing, ...keysWithIds])
  return keysWithIds
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

// ── Sender Keys (групповые чаты) ─────────────────────────────

/** Сохранить свой SenderKey для группового чата */
export async function saveMySenderKey(chatId: string, serialized: string): Promise<void> {
  await set(`my_sender_key:${chatId}`, serialized, keyStore)
}

/** Загрузить свой SenderKey для группового чата */
export async function loadMySenderKey(chatId: string): Promise<string | undefined> {
  return get<string>(`my_sender_key:${chatId}`, keyStore)
}

/** Сохранить SenderKey другого участника группового чата */
export async function savePeerSenderKey(chatId: string, senderId: string, serialized: string): Promise<void> {
  await set(`peer_sender_key:${chatId}:${senderId}`, serialized, keyStore)
}

/** Загрузить SenderKey другого участника группового чата */
export async function loadPeerSenderKey(chatId: string, senderId: string): Promise<string | undefined> {
  return get<string>(`peer_sender_key:${chatId}:${senderId}`, keyStore)
}

// ── Device ID ─────────────────────────────────────────────────

/** Сохраняет ID устройства, полученный от сервера при регистрации. */
export async function saveDeviceId(id: string): Promise<void> {
  await set('device_id', id, keyStore)
}

/** Загружает сохранённый ID устройства. */
export async function loadDeviceId(): Promise<string | undefined> {
  return get<string>('device_id', keyStore)
}

// ── Push subscription ─────────────────────────────────────

export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await set('push_subscription', sub, keyStore)
}

export async function loadPushSubscription(): Promise<PushSubscriptionJSON | undefined> {
  return get<PushSubscriptionJSON>('push_subscription', keyStore)
}
