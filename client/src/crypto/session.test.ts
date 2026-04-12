/**
 * Тесты E2E Session Manager.
 *
 * Проверяет:
 * - sessionKey = peerId:deviceId (Signal Sesame spec)
 * - encryptForAllDevices: отдельный ciphertext на каждое устройство
 * - decryptMessage: раздельные сессии по senderDeviceId
 * - Полный round-trip Alice → Bob с X3DH инициализацией
 *
 * Каждый тест использует уникальные peerIds, чтобы обойти модульный
 * кэш _stateCache в session.ts, который живёт весь процесс vitest.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import _sodium from 'libsodium-wrappers'
import {
  initSodium,
  generateDHKeyPair,
  generateIdentityKeyPair,
  signData,
  toBase64,
} from './x3dh'
import type { DeviceBundle } from '@/api/client'

// ── In-memory хранилища для замены IndexedDB ───────────────────────────────

// Разделённые хранилища: Alice и Bob
const aliceSessions = new Map<string, string>()
const bobSessions = new Map<string, string>()

// Активный контекст: переключается в каждом тесте
let activeStore = aliceSessions

// ── Mocks ─────────────────────────────────────────────────────────────────

let aliceIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobIdentity: ReturnType<typeof generateIdentityKeyPair>
let bobSpk: ReturnType<typeof generateDHKeyPair>

vi.mock('@/crypto/keystore', () => ({
  loadIdentityKey: vi.fn(),
  loadSignedPreKey: vi.fn(),
  consumeOneTimePreKey: vi.fn().mockResolvedValue(undefined),
  loadRatchetSession: vi.fn().mockImplementation(async (key: string) => {
    const raw = activeStore.get(key)
    return raw ? { chatId: key, state: raw, updatedAt: Date.now() } : null
  }),
  saveRatchetSession: vi.fn().mockImplementation(async ({ chatId, state }: { chatId: string; state: string }) => {
    activeStore.set(chatId, state)
  }),
  saveMySenderKey: vi.fn(),
  loadMySenderKey: vi.fn().mockResolvedValue(null),
  deleteMySenderKey: vi.fn(),
  savePeerSenderKey: vi.fn(),
  loadPeerSenderKey: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/api/client', () => ({
  api: {
    getKeyBundle: vi.fn(),
  },
}))

// Импортируем после объявления моков
const { encryptForAllDevices, decryptMessage, encryptMessage } = await import('./session')
const { loadIdentityKey, loadSignedPreKey } = await import('@/crypto/keystore')
const { api } = await import('@/api/client')

// ── Setup ─────────────────────────────────────────────────────────────────

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
  vi.mocked(loadIdentityKey).mockReset()
  vi.mocked(loadSignedPreKey).mockReset()
  vi.mocked(api.getKeyBundle).mockReset()
})

// ── Helpers ────────────────────────────────────────────────────────────────

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

/** Счётчик для уникальных peerIds — обходит модульный _stateCache */
let testCounter = 0
function uniquePeer() {
  testCounter++
  return { aliceId: `alice-${testCounter}`, bobId: `bob-${testCounter}`, deviceBase: `dev-${testCounter}` }
}

// ── Тесты ─────────────────────────────────────────────────────────────────

describe('encryptForAllDevices', () => {
  it('возвращает по одному ciphertext для каждого устройства', async () => {
    const { bobId, deviceBase } = uniquePeer()
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions

    const bundles: DeviceBundle[] = [
      makeBobBundle(`${deviceBase}-1`),
      makeBobBundle(`${deviceBase}-2`),
    ]

    const results = await encryptForAllDevices(bobId, bundles, 'hello')

    expect(results).toHaveLength(2)
    expect(results[0].deviceId).toBe(`${deviceBase}-1`)
    expect(results[1].deviceId).toBe(`${deviceBase}-2`)
    // Каждое устройство получает уникальный ciphertext (разные эфемерные ключи)
    expect(results[0].ciphertext).not.toBe(results[1].ciphertext)
    expect(results[0].ciphertext.length).toBeGreaterThan(0)
    expect(results[1].ciphertext.length).toBeGreaterThan(0)
  })

  it('возвращает пустой массив для пустого bundles', async () => {
    const { bobId } = uniquePeer()
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions

    const results = await encryptForAllDevices(bobId, [], 'hello')
    expect(results).toHaveLength(0)
  })
})

describe('decryptMessage', () => {
  it('full round-trip: Alice шифрует для device-1, Bob расшифровывает', async () => {
    const { aliceId, bobId, deviceBase } = uniquePeer()

    // Alice шифрует
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions
    const bundle = makeBobBundle(`${deviceBase}-1`)
    const [{ ciphertext }] = await encryptForAllDevices(bobId, [bundle], 'секрет')

    // Bob расшифровывает
    vi.mocked(loadIdentityKey).mockResolvedValue(bobIdentity)
    vi.mocked(loadSignedPreKey).mockResolvedValue(bobSpk)
    activeStore = bobSessions

    const plaintext = await decryptMessage(aliceId, `${aliceId}-dev`, ciphertext)
    expect(plaintext).toBe('секрет')
  })

  it('device-1 и device-2 имеют раздельные сессии (независимые ключи)', async () => {
    const { aliceId, bobId, deviceBase } = uniquePeer()

    // Alice шифрует для двух устройств Bob
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions

    const bundles = [
      makeBobBundle(`${deviceBase}-1`),
      makeBobBundle(`${deviceBase}-2`),
    ]
    const encrypted = await encryptForAllDevices(bobId, bundles, 'раздельный секрет')

    const ct1 = encrypted.find((e) => e.deviceId === `${deviceBase}-1`)!.ciphertext
    const ct2 = encrypted.find((e) => e.deviceId === `${deviceBase}-2`)!.ciphertext
    expect(ct1).not.toBe(ct2)

    // Bob расшифровывает для device-1
    vi.mocked(loadIdentityKey).mockResolvedValue(bobIdentity)
    vi.mocked(loadSignedPreKey).mockResolvedValue(bobSpk)
    activeStore = bobSessions

    const senderDev1 = `${aliceId}-dev1`
    const senderDev2 = `${aliceId}-dev2`
    const plain1 = await decryptMessage(aliceId, senderDev1, ct1)
    expect(plain1).toBe('раздельный секрет')

    // Bob расшифровывает для device-2 (другой sessionKey)
    const plain2 = await decryptMessage(aliceId, senderDev2, ct2)
    expect(plain2).toBe('раздельный секрет')

    // Сессии хранятся под разными ключами (Signal Sesame: peerId:deviceId)
    expect(bobSessions.has(`${aliceId}:${senderDev1}`)).toBe(true)
    expect(bobSessions.has(`${aliceId}:${senderDev2}`)).toBe(true)
    expect(bobSessions.get(`${aliceId}:${senderDev1}`)).not.toBe(
      bobSessions.get(`${aliceId}:${senderDev2}`)
    )
  })

  it('несколько сообщений подряд — рэтчет продвигается корректно', async () => {
    const { aliceId, bobId, deviceBase } = uniquePeer()
    const senderDev = `${aliceId}-dev`

    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions
    const bundle = makeBobBundle(`${deviceBase}-1`)

    const [{ ciphertext: ct1 }] = await encryptForAllDevices(bobId, [bundle], 'первое')
    const [{ ciphertext: ct2 }] = await encryptForAllDevices(bobId, [bundle], 'второе')
    const [{ ciphertext: ct3 }] = await encryptForAllDevices(bobId, [bundle], 'третье')

    vi.mocked(loadIdentityKey).mockResolvedValue(bobIdentity)
    vi.mocked(loadSignedPreKey).mockResolvedValue(bobSpk)
    activeStore = bobSessions

    expect(await decryptMessage(aliceId, senderDev, ct1)).toBe('первое')
    expect(await decryptMessage(aliceId, senderDev, ct2)).toBe('второе')
    expect(await decryptMessage(aliceId, senderDev, ct3)).toBe('третье')
  })
})

describe('encryptMessage (single-device fallback)', () => {
  it('шифрует через первое устройство из api.getKeyBundle', async () => {
    const { bobId, deviceBase } = uniquePeer()
    const bundle = makeBobBundle(`${deviceBase}-1`)
    vi.mocked(api.getKeyBundle).mockResolvedValue({ devices: [bundle] })
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)
    activeStore = aliceSessions

    const ciphertext = await encryptMessage(bobId, 'hello fallback')
    expect(typeof ciphertext).toBe('string')
    expect(ciphertext.length).toBeGreaterThan(0)
  })

  it('бросает ошибку если устройств нет', async () => {
    vi.mocked(api.getKeyBundle).mockResolvedValue({ devices: [] })
    vi.mocked(loadIdentityKey).mockResolvedValue(aliceIdentity)

    await expect(encryptMessage('ghost-user', 'test')).rejects.toThrow('No devices found for ghost-user')
  })
})
