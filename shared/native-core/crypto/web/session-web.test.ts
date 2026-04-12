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

const aliceSessions = new Map<string, string>()
const bobSessions = new Map<string, string>()
const mySenderKeys = new Map<string, string>()
const peerSenderKeys = new Map<string, string>()

let activeSessions = aliceSessions

let aliceIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobSpk: ReturnType<typeof generateDHKeyPair>

vi.mock('@/crypto/keystore', () => ({
  loadIdentityKey: vi.fn(),
  loadSignedPreKey: vi.fn(),
  consumeOneTimePreKey: vi.fn().mockResolvedValue(undefined),
  loadRatchetSession: vi.fn().mockImplementation(async (key: string) => {
    const raw = activeSessions.get(key)
    return raw ? { chatId: key, state: raw, updatedAt: Date.now() } : null
  }),
  saveRatchetSession: vi.fn().mockImplementation(async ({ chatId, state }: { chatId: string; state: string }) => {
    activeSessions.set(chatId, state)
  }),
  saveMySenderKey: vi.fn().mockImplementation(async (chatId: string, state: string) => {
    mySenderKeys.set(chatId, state)
  }),
  loadMySenderKey: vi.fn().mockImplementation(async (chatId: string) => mySenderKeys.get(chatId) ?? null),
  deleteMySenderKey: vi.fn().mockImplementation(async (chatId: string) => {
    mySenderKeys.delete(chatId)
  }),
  savePeerSenderKey: vi.fn().mockImplementation(async (chatId: string, senderId: string, state: string) => {
    peerSenderKeys.set(`${chatId}:${senderId}`, state)
  }),
  loadPeerSenderKey: vi.fn().mockImplementation(async (chatId: string, senderId: string) => {
    return peerSenderKeys.get(`${chatId}:${senderId}`) ?? null
  }),
}))

vi.mock('@/api/client', () => ({
  api: {
    getKeyBundle: vi.fn(),
  },
}))

const {
  createSessionWebRuntime,
  decryptGroupMessage,
  decryptMessage,
  encryptForAllDevices,
  encryptGroupMessage,
  handleIncomingSKDM,
} = await import('./session-web')
const { loadIdentityKey, loadSignedPreKey } = await import('@/crypto/keystore')
const { api } = await import('@/api/client')

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
  vi.mocked(loadIdentityKey).mockReset()
  vi.mocked(loadSignedPreKey).mockReset()
  vi.mocked(api.getKeyBundle).mockReset()
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

describe('shared session-web', () => {
  it('выполняет individual round-trip без client/src/crypto/session.ts', async () => {
    const ids = uniqueIds()

    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeSessions = aliceSessions

    const [{ ciphertext }] = await encryptForAllDevices(
      ids.bobId,
      [makeBobBundle(ids.deviceId)],
      'shared-session-secret',
    )

    vi.mocked(loadIdentityKey).mockResolvedValue(bobIdentity)
    vi.mocked(loadSignedPreKey).mockResolvedValue(bobSpk)
    activeSessions = bobSessions

    const plaintext = await decryptMessage(ids.aliceId, `${ids.aliceId}-device`, ciphertext)
    expect(plaintext).toBe('shared-session-secret')
  })

  it('выполняет Sender Keys distribution и group decrypt без client/src/crypto/session.ts', async () => {
    const ids = uniqueIds()

    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeSessions = aliceSessions
    vi.mocked(api.getKeyBundle).mockResolvedValue({
      devices: [makeBobBundle(ids.deviceId)],
    })

    const groupEncrypted = await encryptGroupMessage(
      ids.chatId,
      ids.aliceId,
      [ids.aliceId, ids.bobId],
      'group-secret',
    )

    expect(groupEncrypted.skdmRecipients).toHaveLength(1)

    vi.mocked(loadIdentityKey).mockResolvedValue(bobIdentity)
    vi.mocked(loadSignedPreKey).mockResolvedValue(bobSpk)
    activeSessions = bobSessions

    await handleIncomingSKDM(
      ids.chatId,
      ids.aliceId,
      `${ids.aliceId}-device`,
      groupEncrypted.skdmRecipients[0].encodedSkdm,
    )

    const plaintext = await decryptGroupMessage(
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
