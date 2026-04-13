import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import _sodium from '../../../../client/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'

import {
  generateDHKeyPair,
  generateIdentityKeyPair,
  initSodium,
  signData,
  toBase64,
} from './x3dh-web'
import type { DeviceBundle } from '@/api/client'

const aliceSessions = new Map<string, Uint8Array>()
const bobSessions = new Map<string, Uint8Array>()
const mySenderKeys = new Map<string, string>()
const peerSenderKeys = new Map<string, string>()

let aliceIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobSpk: ReturnType<typeof generateDHKeyPair>

const {
  createSessionWebRuntime,
} = await import('./session-web')

beforeAll(async () => {
  await initSodium()
  await _sodium.ready

  aliceIdentity = generateIdentityKeyPair()
  bobIdentity = generateIdentityKeyPair()
  bobSpk = generateDHKeyPair(1)
})

afterEach(() => {
  aliceSessions.clear()
  bobSessions.clear()
  mySenderKeys.clear()
  peerSenderKeys.clear()
})

function makeBobBundle(deviceId: string): DeviceBundle {
  const spkSig = signData(bobSpk.publicKey, bobIdentity.privateKey)
  return {
    deviceId,
    ikPublic: toBase64(bobIdentity.publicKey),
    spkId: 1,
    spkPublic: toBase64(bobSpk.publicKey),
    spkSignature: toBase64(spkSig),
  }
}

let testCounter = 0
function uniqueIds() {
  testCounter += 1
  return {
    aliceId: `alice-web-${testCounter}`,
    bobId: `bob-web-${testCounter}`,
    chatId: `chat-web-${testCounter}`,
    deviceId: `device-web-${testCounter}`,
  }
}

function createRuntimeStore(
  identity: ReturnType<typeof generateIdentityKeyPair>,
  signedPreKey: ReturnType<typeof generateDHKeyPair>,
  sessions: Map<string, Uint8Array>,
  ownerPrefix: 'alice' | 'bob',
) {
  return {
    async loadIdentityKey() {
      return identity
    },
    async loadSignedPreKey() {
      return signedPreKey
    },
    async consumeOneTimePreKey() {
      return undefined
    },
    async loadRatchetSession(chatId: string) {
      const state = sessions.get(chatId)
      return state ? { chatId, state, updatedAt: Date.now() } : undefined
    },
    async saveRatchetSession(data: { chatId: string; state: Uint8Array }) {
      sessions.set(data.chatId, data.state)
    },
    async saveMySenderKey(chatId: string, serialized: string) {
      mySenderKeys.set(`${ownerPrefix}:${chatId}`, serialized)
    },
    async loadMySenderKey(chatId: string) {
      return mySenderKeys.get(`${ownerPrefix}:${chatId}`)
    },
    async deleteMySenderKey(chatId: string) {
      mySenderKeys.delete(`${ownerPrefix}:${chatId}`)
    },
    async savePeerSenderKey(chatId: string, senderId: string, serialized: string) {
      peerSenderKeys.set(`${ownerPrefix}:${chatId}:${senderId}`, serialized)
    },
    async loadPeerSenderKey(chatId: string, senderId: string) {
      return peerSenderKeys.get(`${ownerPrefix}:${chatId}:${senderId}`)
    },
  }
}

describe('shared session-web', () => {
  it('выполняет individual round-trip без client/src/crypto/session.ts', async () => {
    const ids = uniqueIds()
    const aliceRuntime = createSessionWebRuntime({
      api: {
        async getKeyBundle() {
          return { devices: [makeBobBundle(ids.deviceId)] }
        },
      },
      store: createRuntimeStore(aliceIdentity, bobSpk, aliceSessions, 'alice'),
    })
    const bobRuntime = createSessionWebRuntime({
      api: {
        async getKeyBundle() {
          return { devices: [makeBobBundle(ids.deviceId)] }
        },
      },
      store: createRuntimeStore(bobIdentity, bobSpk, bobSessions, 'bob'),
    })

    const [{ ciphertext }] = await aliceRuntime.encryptForAllDevices(
      ids.bobId,
      [makeBobBundle(ids.deviceId)],
      'shared-session-secret',
    )

    const plaintext = await bobRuntime.decryptMessage(ids.aliceId, `${ids.aliceId}-device`, ciphertext)
    expect(plaintext).toBe('shared-session-secret')
  })

  it('выполняет Sender Keys distribution и group decrypt без client/src/crypto/session.ts', async () => {
    const ids = uniqueIds()
    const aliceRuntime = createSessionWebRuntime({
      api: {
        async getKeyBundle() {
          return { devices: [makeBobBundle(ids.deviceId)] }
        },
      },
      store: createRuntimeStore(aliceIdentity, bobSpk, aliceSessions, 'alice'),
    })
    const bobRuntime = createSessionWebRuntime({
      api: {
        async getKeyBundle() {
          return { devices: [makeBobBundle(ids.deviceId)] }
        },
      },
      store: createRuntimeStore(bobIdentity, bobSpk, bobSessions, 'bob'),
    })

    const groupEncrypted = await aliceRuntime.encryptGroupMessage(
      ids.chatId,
      ids.aliceId,
      [ids.aliceId, ids.bobId],
      'group-secret',
    )

    expect(groupEncrypted.skdmRecipients).toHaveLength(1)

    await bobRuntime.handleIncomingSKDM(
      ids.chatId,
      ids.aliceId,
      `${ids.aliceId}-device`,
      groupEncrypted.skdmRecipients[0].encodedSkdm,
    )

    const plaintext = await bobRuntime.decryptGroupMessage(
      ids.chatId,
      ids.aliceId,
      groupEncrypted.encodedPayload,
    )

    expect(plaintext).toBe('group-secret')
    expect(groupEncrypted.skdmRecipients[0].encodedSkdm.length).toBeGreaterThan(0)
  })

  it('работает через явные deps без default runtime import из client', async () => {
    const ids = uniqueIds()
    const runtimeSessions = new Map<string, Uint8Array>()
    const runtimeMySenderKeys = new Map<string, string>()
    const runtimePeerSenderKeys = new Map<string, string>()

    const runtime = createSessionWebRuntime({
      api: {
        async getKeyBundle() {
          return { devices: [makeBobBundle(ids.deviceId)] }
        },
      },
      store: {
        async loadIdentityKey() {
          return aliceIdentity
        },
        async loadSignedPreKey() {
          return bobSpk
        },
        async consumeOneTimePreKey() {
          return undefined
        },
        async loadRatchetSession(chatId: string) {
          const state = runtimeSessions.get(chatId)
          return state ? { chatId, state, updatedAt: Date.now() } : undefined
        },
        async saveRatchetSession(data) {
          runtimeSessions.set(data.chatId, data.state)
        },
        async saveMySenderKey(chatId: string, serialized: string) {
          runtimeMySenderKeys.set(chatId, serialized)
        },
        async loadMySenderKey(chatId: string) {
          return runtimeMySenderKeys.get(chatId)
        },
        async deleteMySenderKey(chatId: string) {
          runtimeMySenderKeys.delete(chatId)
        },
        async savePeerSenderKey(chatId: string, senderId: string, serialized: string) {
          runtimePeerSenderKeys.set(`${chatId}:${senderId}`, serialized)
        },
        async loadPeerSenderKey(chatId: string, senderId: string) {
          return runtimePeerSenderKeys.get(`${chatId}:${senderId}`)
        },
      },
    })

    const ciphertext = await runtime.encryptMessage(ids.bobId, 'isolated-runtime')
    expect(ciphertext.length).toBeGreaterThan(0)
  })
})
