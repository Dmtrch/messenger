import { describe, expect, it, vi } from 'vitest'

import { InMemoryStorageRuntime } from '../storage/storage-runtime'
import {
  CryptoRuntime,
  type CryptoAdapter,
  type DeviceBundle,
  type RatchetRuntimeState,
  type SenderKeyDistribution,
  type SenderKeyRuntimeState,
} from './crypto-runtime'

function makeIdentityPair() {
  return {
    publicKey: new Uint8Array([1, 2, 3]),
    privateKey: new Uint8Array([4, 5, 6]),
  }
}

function makeSignedPreKey(id = 7) {
  return {
    id,
    publicKey: new Uint8Array([7, 8, 9]),
    privateKey: new Uint8Array([10, 11, 12]),
  }
}

function makeRatchetState(label: number): RatchetRuntimeState {
  return {
    sessionKey: new Uint8Array([label, label + 1]),
    sendChainKey: new Uint8Array([label + 2]),
    recvChainKey: new Uint8Array([label + 3]),
  }
}

function makeBundle(deviceId = 'device-2'): DeviceBundle {
  return {
    deviceId,
    ikPublic: new Uint8Array([21, 22]),
    spkId: 9,
    spkPublic: new Uint8Array([23, 24]),
    spkSignature: new Uint8Array([25, 26]),
    opkId: 11,
    opkPublic: new Uint8Array([27, 28]),
  }
}

function makeSenderKeyState(label: number): SenderKeyRuntimeState {
  return {
    chainKey: new Uint8Array([label, label + 1]),
    iteration: label,
    signingPublicKey: new Uint8Array([label + 2]),
    signingPrivateKey: new Uint8Array([label + 3]),
  }
}

function createAdapter(): CryptoAdapter {
  return {
    generateIdentityKeyPair: vi.fn().mockReturnValue(makeIdentityPair()),
    generateSignedPreKey: vi.fn().mockReturnValue(makeSignedPreKey()),
    signPreKey: vi.fn().mockReturnValue(new Uint8Array([13, 14])),
    generateEphemeralKeyPair: vi.fn().mockReturnValue(makeSignedPreKey(99)),
    createOutboundSharedSecret: vi.fn().mockReturnValue({
      sharedSecret: new Uint8Array([31, 32]),
      ephemeralPublicKey: new Uint8Array([33, 34]),
      usedOpkId: 11,
      ratchetKeyPair: makeSignedPreKey(99),
    }),
    createInboundSharedSecret: vi.fn().mockReturnValue(new Uint8Array([41, 42])),
    initOutboundRatchet: vi.fn().mockResolvedValue(makeRatchetState(51)),
    initInboundRatchet: vi.fn().mockResolvedValue(makeRatchetState(61)),
    decryptMessage: vi.fn().mockResolvedValue({
      plaintext: 'hello',
      nextState: makeRatchetState(71),
    }),
    encryptMessage: vi.fn().mockResolvedValue({
      ciphertext: new Uint8Array([81, 82]),
      nextState: makeRatchetState(83),
    }),
    generateSenderKey: vi.fn().mockResolvedValue(makeSenderKeyState(91)),
    createSenderKeyDistribution: vi.fn().mockImplementation((senderId: string, chatId: string) => ({
      senderId,
      chatId,
      chainKey: new Uint8Array([92]),
      iteration: 91,
      signingPublicKey: new Uint8Array([93]),
    })),
    importSenderKeyDistribution: vi.fn().mockReturnValue(makeSenderKeyState(94)),
    encryptGroupMessage: vi.fn().mockResolvedValue({
      payload: new Uint8Array([95, 96]),
      nextState: makeSenderKeyState(97),
    }),
    decryptGroupMessage: vi.fn().mockResolvedValue({
      plaintext: 'group-hello',
      nextState: makeSenderKeyState(98),
    }),
  }
}

describe('CryptoRuntime', () => {
  it('generateIdentityBundle сохраняет identity/spk в storage и возвращает device bundle', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 1_000 })

    const bundle = await runtime.generateIdentityBundle()

    expect(bundle.deviceIdentity.ikPublic).toEqual(new Uint8Array([1, 2, 3]))
    expect(bundle.deviceIdentity.spkId).toBe(7)
    expect(bundle.deviceIdentity.spkSignature).toEqual(new Uint8Array([13, 14]))
    expect(await storage.loadIdentityKey()).toEqual(makeIdentityPair())
    expect(await storage.loadSignedPreKey()).toEqual(makeSignedPreKey())
  })

  it('createOutboundSession создаёт device-scoped ratchet session и пишет её в storage', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 2_000 })

    await storage.saveIdentityKey(makeIdentityPair())
    await storage.saveSignedPreKey(makeSignedPreKey())

    const result = await runtime.createOutboundSession('user-2', 'device-2', makeBundle())

    expect(result.sessionId).toBe('user-2:device-2')
    expect(result.bootstrap.usedOpkId).toBe(11)
    expect(adapter.createOutboundSharedSecret).toHaveBeenCalled()
    expect(adapter.initOutboundRatchet).toHaveBeenCalledWith(
      new Uint8Array([31, 32]),
      makeSignedPreKey(99),
      makeBundle().spkPublic,
    )
    expect(await storage.loadRatchetSession('user-2:device-2')).toEqual({
      sessionKey: 'user-2:device-2',
      state: result.serializedState,
      updatedAt: 2_000,
    })
  })

  it('decryptInboundSessionMessage при отсутствии session инициализирует inbound session через storage hooks', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 3_000 })

    await storage.saveIdentityKey(makeIdentityPair())
    await storage.saveSignedPreKey(makeSignedPreKey())
    await storage.saveOneTimePreKeys([{ id: 11, publicKey: new Uint8Array([1]), privateKey: new Uint8Array([2]) }])

    const result = await runtime.decryptInboundSessionMessage('user-2', 'device-2', {
      ikPublic: new Uint8Array([91, 92]),
      ekPublic: new Uint8Array([93, 94]),
      opkId: 11,
      ciphertext: new Uint8Array([95]),
    })

    expect(result.plaintext).toBe('hello')
    expect(adapter.createInboundSharedSecret).toHaveBeenCalled()
    expect(adapter.initInboundRatchet).toHaveBeenCalledWith(
      new Uint8Array([41, 42]),
      makeSignedPreKey(),
      new Uint8Array([93, 94]),
    )
    expect(await storage.loadRatchetSession('user-2:device-2')).toEqual({
      sessionKey: 'user-2:device-2',
      state: result.serializedState,
      updatedAt: 3_000,
    })
    expect(await storage.loadOneTimePreKeys()).toEqual([])
  })

  it('encryptForDevices использует существующую device-scoped session и сохраняет новый ratchet state', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 4_000 })

    await storage.saveRatchetSession({
      sessionKey: 'user-2:device-2',
      state: new TextEncoder().encode(JSON.stringify({
        sessionKey: [1, 2],
        sendChainKey: [3],
        recvChainKey: [4],
      })),
      updatedAt: 1_000,
    })

    const result = await runtime.encryptForDevices('chat-1', [{
      userId: 'user-2',
      bundle: makeBundle(),
    }], 'hello-device')

    expect(result).toHaveLength(1)
    expect(result[0]?.userId).toBe('user-2')
    expect(result[0]?.deviceId).toBe('device-2')
    expect(result[0]?.bootstrap).toBeUndefined()
    expect(adapter.encryptMessage).toHaveBeenCalled()
    expect(await storage.loadRatchetSession('user-2:device-2')).toEqual({
      sessionKey: 'user-2:device-2',
      state: result[0]?.serializedState,
      updatedAt: 4_000,
    })
  })

  it('encryptGroupMessage при первом вызове создаёт Sender Key и SKDM для участников', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 5_000 })

    const result = await runtime.encryptGroupMessage('chat-1', 'user-1', ['user-1', 'user-2'], 'hello-group')

    expect(adapter.generateSenderKey).toHaveBeenCalled()
    expect(adapter.createSenderKeyDistribution).toHaveBeenCalledWith('user-1', 'chat-1', makeSenderKeyState(91))
    expect(result.distributions).toHaveLength(1)
    expect(result.distributions[0]).toEqual({
      userId: 'user-2',
      distribution: {
        senderId: 'user-1',
        chatId: 'chat-1',
        chainKey: new Uint8Array([92]),
        iteration: 91,
        signingPublicKey: new Uint8Array([93]),
      },
    })
    expect(await storage.loadMySenderKey('chat-1')).toBeTruthy()
  })

  it('handleIncomingSenderKeyDistribution + decryptGroupMessage восстанавливают peer sender key и plaintext', async () => {
    const storage = new InMemoryStorageRuntime()
    const adapter = createAdapter()
    const runtime = new CryptoRuntime({ storage, adapter, now: () => 6_000 })

    const distribution: SenderKeyDistribution = {
      senderId: 'user-2',
      chatId: 'chat-1',
      chainKey: new Uint8Array([101]),
      iteration: 4,
      signingPublicKey: new Uint8Array([102]),
    }

    await runtime.handleIncomingSenderKeyDistribution('chat-1', 'user-2', distribution)
    const plaintext = await runtime.decryptGroupMessage('chat-1', 'user-2', new Uint8Array([103]))

    expect(adapter.importSenderKeyDistribution).toHaveBeenCalledWith(distribution)
    expect(adapter.decryptGroupMessage).toHaveBeenCalled()
    expect(plaintext).toBe('group-hello')
    expect(await storage.loadPeerSenderKey('chat-1', 'user-2')).toBeTruthy()
  })
})
