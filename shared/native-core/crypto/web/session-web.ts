/**
 * E2E Session Manager.
 *
 * Управляет жизненным циклом Double Ratchet сессий:
 * - Первое сообщение: X3DH → общий секрет → инициализация рэтчета
 * - Последующие: encrypt/decrypt через Double Ratchet
 * - Состояния хранятся в переданном storage adapter
 *
 * sessionKey = peerId:deviceId (Signal Sesame spec)
 * Сессия — между парой устройств, не зависит от чата.
 */

import {
  createSKDistribution,
  deserializeSenderKeyState,
  generateSenderKey,
  importSKDistribution,
  senderKeyDecrypt,
  senderKeyEncrypt,
  serializeSenderKeyState,
  type GroupWirePayload,
  type SKDistributionMessage,
} from './senderkey-web'
import {
  fromBase64,
  generateDHKeyPair,
  initSodium,
  toBase64,
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
  type DHKeyPair,
  type IdentityKeyPair,
  type PublicKeyBundle,
} from './x3dh-web'
import {
  deserializeRatchetState,
  initRatchet,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeRatchetState,
  type EncryptedMessage,
  type RatchetState,
} from './ratchet-web'
import type { DeviceBundle } from '@/api/client'

interface WirePayload {
  v: 1
  ek?: string
  opkId?: number
  ikPub?: string
  msg: EncryptedMessage
}

export interface SessionRatchetSessionRecord {
  chatId: string
  state: Uint8Array
  updatedAt: number
}

export interface SessionWebApi {
  getKeyBundle(recipientId: string): Promise<{ devices: DeviceBundle[] }>
}

export interface SessionWebStore {
  loadIdentityKey(): Promise<IdentityKeyPair | undefined>
  loadSignedPreKey(): Promise<DHKeyPair | undefined>
  consumeOneTimePreKey(id: number): Promise<DHKeyPair | undefined>
  loadRatchetSession(chatId: string): Promise<SessionRatchetSessionRecord | undefined>
  saveRatchetSession(data: SessionRatchetSessionRecord): Promise<void>
  saveMySenderKey(chatId: string, serialized: string): Promise<void>
  loadMySenderKey(chatId: string): Promise<string | undefined>
  deleteMySenderKey(chatId: string): Promise<void>
  savePeerSenderKey(chatId: string, senderId: string, serialized: string): Promise<void>
  loadPeerSenderKey(chatId: string, senderId: string): Promise<string | undefined>
}

export interface SessionWebRuntime {
  encryptForAllDevices(
    recipientId: string,
    bundles: DeviceBundle[],
    plaintext: string,
  ): Promise<Array<{ deviceId: string; ciphertext: string }>>
  encryptMessage(recipientId: string, plaintext: string): Promise<string>
  encryptGroupMessage(
    chatId: string,
    myUserId: string,
    members: string[],
    plaintext: string,
  ): Promise<{
    encodedPayload: string
    skdmRecipients: Array<{ userId: string; encodedSkdm: string }>
  }>
  decryptGroupMessage(chatId: string, senderId: string, encodedPayload: string): Promise<string>
  handleIncomingSKDM(
    chatId: string,
    senderId: string,
    senderDeviceId: string,
    encodedSkdm: string,
  ): Promise<void>
  decryptMessage(senderId: string, senderDeviceId: string, encodedPayload: string): Promise<string>
  invalidateGroupSenderKey(chatId: string): Promise<void>
  tryDecryptPreview(
    chatType: 'direct' | 'group',
    chatId: string,
    senderId: string,
    senderDeviceId: string,
    encryptedPayload: string,
  ): Promise<string>
}

export interface SessionWebRuntimeDeps {
  api: SessionWebApi
  store: SessionWebStore
}

let sodiumReady = false
let defaultRuntimePromise: Promise<SessionWebRuntime> | null = null

async function ensureSodium() {
  if (!sodiumReady) {
    await initSodium()
    sodiumReady = true
  }
}

function encodeBase64Json(value: unknown): string {
  return btoa(JSON.stringify(value))
}

function buildSessionKey(peerUserId: string, peerDeviceId: string) {
  return `${peerUserId}:${peerDeviceId}`
}

export function createSessionWebRuntime(deps: SessionWebRuntimeDeps): SessionWebRuntime {
  const stateCache = new Map<string, RatchetState>()

  async function loadState(peerId: string, deviceId: string): Promise<RatchetState | null> {
    const key = buildSessionKey(peerId, deviceId)
    if (stateCache.has(key)) return stateCache.get(key)!

    const stored = await deps.store.loadRatchetSession(key)
    if (!stored) return null

    const state = deserializeRatchetState(stored.state)
    stateCache.set(key, state)
    return state
  }

  async function persistState(peerId: string, deviceId: string, state: RatchetState) {
    const key = buildSessionKey(peerId, deviceId)
    stateCache.set(key, state)
    await deps.store.saveRatchetSession({
      chatId: key,
      state: serializeRatchetState(state),
      updatedAt: Date.now(),
    })
  }

  async function initAsInitiator(
    bundle: DeviceBundle,
    myIdentity: IdentityKeyPair,
  ): Promise<{ state: RatchetState; wire: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> }> {
    const ephemeral = generateDHKeyPair()
    const { sharedSecret, ephemeralKeyPublic, usedOpkId } = x3dhInitiatorAgreement(
      myIdentity,
      ephemeral,
      bundle as unknown as PublicKeyBundle,
    )

    const state = await initRatchet(sharedSecret, ephemeral, fromBase64(bundle.spkPublic), true)

    return {
      state,
      wire: {
        ek: toBase64(ephemeralKeyPublic),
        opkId: usedOpkId,
        ikPub: toBase64(myIdentity.publicKey),
      },
    }
  }

  async function initAsResponder(
    wire: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'>,
  ): Promise<RatchetState> {
    const myIdentity = await deps.store.loadIdentityKey()
    const mySpk = await deps.store.loadSignedPreKey()
    if (!myIdentity || !mySpk) throw new Error('Ключи не найдены — переустановите приложение')

    const aliceIkPublic = fromBase64(wire.ikPub!)
    const aliceEkPublic = fromBase64(wire.ek!)
    const myOpk = wire.opkId !== undefined
      ? await deps.store.consumeOneTimePreKey(wire.opkId)
      : undefined

    const sharedSecret = x3dhResponderAgreement(
      myIdentity,
      mySpk,
      myOpk,
      aliceIkPublic,
      aliceEkPublic,
    )

    return initRatchet(sharedSecret, mySpk, aliceEkPublic, false)
  }

  async function encryptForDevice(
    recipientId: string,
    bundle: DeviceBundle,
    plaintext: string,
  ): Promise<string> {
    const myIdentity = await deps.store.loadIdentityKey()
    if (!myIdentity) throw new Error('Identity key not found')

    let state = await loadState(recipientId, bundle.deviceId)
    let wireExtra: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> = {}

    if (!state) {
      const initiated = await initAsInitiator(bundle, myIdentity)
      state = initiated.state
      wireExtra = initiated.wire
    }

    const encrypted = await ratchetEncrypt(state, plaintext)
    await persistState(recipientId, bundle.deviceId, encrypted.nextState)

    const payload: WirePayload = { v: 1, ...wireExtra, msg: encrypted.message }
    return encodeBase64Json(payload)
  }

  return {
    async encryptForAllDevices(recipientId, bundles, plaintext) {
      await ensureSodium()

      return Promise.all(
        bundles.map(async (bundle) => ({
          deviceId: bundle.deviceId,
          ciphertext: await encryptForDevice(recipientId, bundle, plaintext),
        })),
      )
    },

    async encryptMessage(recipientId, plaintext) {
      await ensureSodium()

      const { devices } = await deps.api.getKeyBundle(recipientId)
      if (!devices.length) throw new Error(`No devices found for ${recipientId}`)
      return encryptForDevice(recipientId, devices[0], plaintext)
    },

    async encryptGroupMessage(chatId, myUserId, members, plaintext) {
      await ensureSodium()

      let skdmRecipients: Array<{ userId: string; encodedSkdm: string }> = []
      const mySenderKeySerialized = await deps.store.loadMySenderKey(chatId)
      let mySenderKey = mySenderKeySerialized ? deserializeSenderKeyState(mySenderKeySerialized) : null

      if (!mySenderKey) {
        mySenderKey = await generateSenderKey()
        await deps.store.saveMySenderKey(chatId, serializeSenderKeyState(mySenderKey))

        const skdm = createSKDistribution(myUserId, chatId, mySenderKey)
        const skdmJson = JSON.stringify(skdm)

        skdmRecipients = await Promise.all(
          members
            .filter((userId) => userId !== myUserId)
            .map(async (userId) => ({
              userId,
              encodedSkdm: await this.encryptMessage(userId, skdmJson),
            })),
        )
      }

      const encrypted = await senderKeyEncrypt(mySenderKey, chatId, plaintext)
      await deps.store.saveMySenderKey(chatId, serializeSenderKeyState(encrypted.nextState))

      return {
        encodedPayload: encodeBase64Json(encrypted.payload),
        skdmRecipients,
      }
    },

    async decryptGroupMessage(chatId, senderId, encodedPayload) {
      await ensureSodium()

      const payload = JSON.parse(atob(encodedPayload)) as GroupWirePayload
      if (payload.type !== 'group') throw new Error('Not a group wire payload')

      const peerSenderKeySerialized = await deps.store.loadPeerSenderKey(chatId, senderId)
      if (!peerSenderKeySerialized) throw new Error(`No sender key for ${senderId} in ${chatId}`)

      const peerSenderKey = deserializeSenderKeyState(peerSenderKeySerialized)
      const decrypted = await senderKeyDecrypt(peerSenderKey, payload)
      await deps.store.savePeerSenderKey(
        chatId,
        senderId,
        serializeSenderKeyState(decrypted.nextState),
      )

      return decrypted.plaintext
    },

    async handleIncomingSKDM(chatId, senderId, senderDeviceId, encodedSkdm) {
      await ensureSodium()

      const skdmJson = await this.decryptMessage(senderId, senderDeviceId, encodedSkdm)
      const skdm = JSON.parse(skdmJson) as SKDistributionMessage
      const state = importSKDistribution(skdm)

      await deps.store.savePeerSenderKey(chatId, senderId, serializeSenderKeyState(state))
    },

    async decryptMessage(senderId, senderDeviceId, encodedPayload) {
      await ensureSodium()

      let payload: WirePayload
      try {
        payload = JSON.parse(atob(encodedPayload)) as WirePayload
      } catch {
        try {
          const bytes = Uint8Array.from(atob(encodedPayload), (char) => char.charCodeAt(0))
          return new TextDecoder().decode(bytes)
        } catch {
          return encodedPayload
        }
      }

      if (!payload.msg) return atob(encodedPayload)

      let state = await loadState(senderId, senderDeviceId)
      if (!state && payload.ek && payload.ikPub) {
        state = await initAsResponder(payload)
      }
      if (!state) throw new Error('No session and no X3DH header')

      const decrypted = await ratchetDecrypt(state, payload.msg)
      await persistState(senderId, senderDeviceId, decrypted.nextState)

      return decrypted.plaintext
    },

    async invalidateGroupSenderKey(chatId) {
      await deps.store.deleteMySenderKey(chatId)
    },

    async tryDecryptPreview(chatType, chatId, senderId, senderDeviceId, encryptedPayload) {
      try {
        const plaintext = chatType === 'group'
          ? await this.decryptGroupMessage(chatId, senderId, encryptedPayload)
          : await this.decryptMessage(senderId, senderDeviceId, encryptedPayload)

        try {
          const payload = JSON.parse(plaintext) as Record<string, unknown>
          if (payload && typeof payload.mediaId === 'string') return '📎 Вложение'
          if (typeof payload.text === 'string') return payload.text
        } catch {
          // Оставляем plain-text как есть.
        }

        return plaintext
      } catch {
        return 'Зашифрованное сообщение'
      }
    },
  }
}

async function loadDefaultDeps(): Promise<SessionWebRuntimeDeps> {
  const [{ api }, store] = await Promise.all([
    import('@/api/client'),
    import('@/crypto/keystore'),
  ])

  return {
    api,
    store,
  }
}

async function getDefaultRuntime(): Promise<SessionWebRuntime> {
  if (!defaultRuntimePromise) {
    defaultRuntimePromise = loadDefaultDeps().then((deps) => createSessionWebRuntime(deps))
  }
  return defaultRuntimePromise
}

export async function encryptForAllDevices(
  recipientId: string,
  bundles: DeviceBundle[],
  plaintext: string,
): Promise<Array<{ deviceId: string; ciphertext: string }>> {
  return (await getDefaultRuntime()).encryptForAllDevices(recipientId, bundles, plaintext)
}

export async function encryptMessage(
  recipientId: string,
  plaintext: string,
): Promise<string> {
  return (await getDefaultRuntime()).encryptMessage(recipientId, plaintext)
}

export async function encryptGroupMessage(
  chatId: string,
  myUserId: string,
  members: string[],
  plaintext: string,
): Promise<{
  encodedPayload: string
  skdmRecipients: Array<{ userId: string; encodedSkdm: string }>
}> {
  return (await getDefaultRuntime()).encryptGroupMessage(chatId, myUserId, members, plaintext)
}

export async function decryptGroupMessage(
  chatId: string,
  senderId: string,
  encodedPayload: string,
): Promise<string> {
  return (await getDefaultRuntime()).decryptGroupMessage(chatId, senderId, encodedPayload)
}

export async function handleIncomingSKDM(
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encodedSkdm: string,
): Promise<void> {
  return (await getDefaultRuntime()).handleIncomingSKDM(chatId, senderId, senderDeviceId, encodedSkdm)
}

export async function decryptMessage(
  senderId: string,
  senderDeviceId: string,
  encodedPayload: string,
): Promise<string> {
  return (await getDefaultRuntime()).decryptMessage(senderId, senderDeviceId, encodedPayload)
}

export async function invalidateGroupSenderKey(chatId: string): Promise<void> {
  return (await getDefaultRuntime()).invalidateGroupSenderKey(chatId)
}

export async function tryDecryptPreview(
  chatType: 'direct' | 'group',
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encryptedPayload: string,
): Promise<string> {
  return (await getDefaultRuntime()).tryDecryptPreview(
    chatType,
    chatId,
    senderId,
    senderDeviceId,
    encryptedPayload,
  )
}
