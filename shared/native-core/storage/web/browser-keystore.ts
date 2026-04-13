/**
 * Browser storage для локального crypto state на базе IndexedDB.
 *
 * Приватные ключи не покидают устройство.
 * Все операции асинхронные и пригодны как для client facade, так и для shared runtime adapters.
 */

import {
  createStore,
  del,
  get,
  set,
  type UseStore,
} from '../../../../client/node_modules/idb-keyval/dist/index.js'

const defaultStore = createStore('messenger-keys', 'keys')

export interface IdentityKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface DHKeyPair {
  id: number
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface RatchetSessionData {
  chatId: string
  state: Uint8Array
  updatedAt: number
}

export interface BrowserCryptoStore {
  saveIdentityKey(pair: IdentityKeyPair): Promise<void>
  loadIdentityKey(): Promise<IdentityKeyPair | undefined>
  saveSignedPreKey(pair: DHKeyPair): Promise<void>
  loadSignedPreKey(): Promise<DHKeyPair | undefined>
  saveOneTimePreKeys(keys: DHKeyPair[]): Promise<void>
  loadOneTimePreKeys(): Promise<DHKeyPair[]>
  consumeOneTimePreKey(id: number): Promise<DHKeyPair | undefined>
  appendOneTimePreKeys(newKeys: Omit<DHKeyPair, 'id'>[]): Promise<DHKeyPair[]>
  saveRatchetSession(data: RatchetSessionData): Promise<void>
  loadRatchetSession(chatId: string): Promise<RatchetSessionData | undefined>
  deleteRatchetSession(chatId: string): Promise<void>
  saveMySenderKey(chatId: string, serialized: string): Promise<void>
  loadMySenderKey(chatId: string): Promise<string | undefined>
  deleteMySenderKey(chatId: string): Promise<void>
  savePeerSenderKey(chatId: string, senderId: string, serialized: string): Promise<void>
  loadPeerSenderKey(chatId: string, senderId: string): Promise<string | undefined>
  saveDeviceId(id: string): Promise<void>
  loadDeviceId(): Promise<string | undefined>
  savePushSubscription(sub: PushSubscriptionJSON): Promise<void>
  loadPushSubscription(): Promise<PushSubscriptionJSON | undefined>
  savePreKeyReplenishTime(): Promise<void>
  isPreKeyReplenishOnCooldown(minIntervalMs: number): Promise<boolean>
}

export function createBrowserCryptoStore() {
  return createBrowserCryptoStoreWithBackend(defaultStore)
}

function createBrowserCryptoStoreWithBackend(store: UseStore): BrowserCryptoStore {
  return {
    async saveIdentityKey(pair) {
      await set('identity_key', pair, store)
    },

    async loadIdentityKey() {
      return get<IdentityKeyPair>('identity_key', store)
    },

    async saveSignedPreKey(pair) {
      await set('signed_prekey', pair, store)
    },

    async loadSignedPreKey() {
      return get<DHKeyPair>('signed_prekey', store)
    },

    async saveOneTimePreKeys(keys) {
      await set('one_time_prekeys', keys, store)
    },

    async loadOneTimePreKeys() {
      return (await get<DHKeyPair[]>('one_time_prekeys', store)) ?? []
    },

    async consumeOneTimePreKey(id) {
      const keys = await this.loadOneTimePreKeys()
      const key = keys.find((entry) => entry.id === id)
      if (key) {
        await this.saveOneTimePreKeys(keys.filter((entry) => entry.id !== id))
      }
      return key
    },

    async appendOneTimePreKeys(newKeys) {
      const existing = await this.loadOneTimePreKeys()
      const maxId = existing.reduce((currentMax, key) => Math.max(currentMax, key.id), 0)
      const keysWithIds: DHKeyPair[] = newKeys.map((key, index) => ({
        ...key,
        id: maxId + 1 + index,
      }))
      await this.saveOneTimePreKeys([...existing, ...keysWithIds])
      return keysWithIds
    },

    async saveRatchetSession(data) {
      await set(`ratchet:${data.chatId}`, data, store)
    },

    async loadRatchetSession(chatId) {
      return get<RatchetSessionData>(`ratchet:${chatId}`, store)
    },

    async deleteRatchetSession(chatId) {
      await del(`ratchet:${chatId}`, store)
    },

    async saveMySenderKey(chatId, serialized) {
      await set(`my_sender_key:${chatId}`, serialized, store)
    },

    async loadMySenderKey(chatId) {
      return get<string>(`my_sender_key:${chatId}`, store)
    },

    async deleteMySenderKey(chatId) {
      await del(`my_sender_key:${chatId}`, store)
    },

    async savePeerSenderKey(chatId, senderId, serialized) {
      await set(`peer_sender_key:${chatId}:${senderId}`, serialized, store)
    },

    async loadPeerSenderKey(chatId, senderId) {
      return get<string>(`peer_sender_key:${chatId}:${senderId}`, store)
    },

    async saveDeviceId(id) {
      await set('device_id', id, store)
    },

    async loadDeviceId() {
      return get<string>('device_id', store)
    },

    async savePushSubscription(sub) {
      await set('push_subscription', sub, store)
    },

    async loadPushSubscription() {
      return get<PushSubscriptionJSON>('push_subscription', store)
    },

    async savePreKeyReplenishTime() {
      await set('prekey_replenish_ts', Date.now(), store)
    },

    async isPreKeyReplenishOnCooldown(minIntervalMs) {
      const ts = await get<number>('prekey_replenish_ts', store)
      if (!ts) return false
      return Date.now() - ts < minIntervalMs
    },
  }
}

const defaultBrowserCryptoStore = createBrowserCryptoStore()

export const saveIdentityKey = defaultBrowserCryptoStore.saveIdentityKey.bind(defaultBrowserCryptoStore)
export const loadIdentityKey = defaultBrowserCryptoStore.loadIdentityKey.bind(defaultBrowserCryptoStore)
export const saveSignedPreKey = defaultBrowserCryptoStore.saveSignedPreKey.bind(defaultBrowserCryptoStore)
export const loadSignedPreKey = defaultBrowserCryptoStore.loadSignedPreKey.bind(defaultBrowserCryptoStore)
export const saveOneTimePreKeys = defaultBrowserCryptoStore.saveOneTimePreKeys.bind(defaultBrowserCryptoStore)
export const loadOneTimePreKeys = defaultBrowserCryptoStore.loadOneTimePreKeys.bind(defaultBrowserCryptoStore)
export const consumeOneTimePreKey = defaultBrowserCryptoStore.consumeOneTimePreKey.bind(defaultBrowserCryptoStore)
export const appendOneTimePreKeys = defaultBrowserCryptoStore.appendOneTimePreKeys.bind(defaultBrowserCryptoStore)
export const saveRatchetSession = defaultBrowserCryptoStore.saveRatchetSession.bind(defaultBrowserCryptoStore)
export const loadRatchetSession = defaultBrowserCryptoStore.loadRatchetSession.bind(defaultBrowserCryptoStore)
export const deleteRatchetSession = defaultBrowserCryptoStore.deleteRatchetSession.bind(defaultBrowserCryptoStore)
export const saveMySenderKey = defaultBrowserCryptoStore.saveMySenderKey.bind(defaultBrowserCryptoStore)
export const loadMySenderKey = defaultBrowserCryptoStore.loadMySenderKey.bind(defaultBrowserCryptoStore)
export const deleteMySenderKey = defaultBrowserCryptoStore.deleteMySenderKey.bind(defaultBrowserCryptoStore)
export const savePeerSenderKey = defaultBrowserCryptoStore.savePeerSenderKey.bind(defaultBrowserCryptoStore)
export const loadPeerSenderKey = defaultBrowserCryptoStore.loadPeerSenderKey.bind(defaultBrowserCryptoStore)
export const saveDeviceId = defaultBrowserCryptoStore.saveDeviceId.bind(defaultBrowserCryptoStore)
export const loadDeviceId = defaultBrowserCryptoStore.loadDeviceId.bind(defaultBrowserCryptoStore)
export const savePushSubscription = defaultBrowserCryptoStore.savePushSubscription.bind(defaultBrowserCryptoStore)
export const loadPushSubscription = defaultBrowserCryptoStore.loadPushSubscription.bind(defaultBrowserCryptoStore)
export const savePreKeyReplenishTime = defaultBrowserCryptoStore.savePreKeyReplenishTime.bind(defaultBrowserCryptoStore)
export const isPreKeyReplenishOnCooldown =
  defaultBrowserCryptoStore.isPreKeyReplenishOnCooldown.bind(defaultBrowserCryptoStore)
