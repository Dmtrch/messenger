import { describe, expect, it } from 'vitest'

import {
  InMemoryStorageRuntime,
  type AttachmentRecord,
  type DeviceIdentityKeyPair,
  type DeviceKeyPair,
  type DeviceRecord,
  type RatchetSessionRecord,
} from './storage-runtime'

function makeIdentityKeyPair(): DeviceIdentityKeyPair {
  return {
    publicKey: new Uint8Array([1, 2, 3]),
    privateKey: new Uint8Array([4, 5, 6]),
  }
}

function makeSignedPreKey(id = 1): DeviceKeyPair {
  return {
    id,
    publicKey: new Uint8Array([7, 8, 9]),
    privateKey: new Uint8Array([10, 11, 12]),
  }
}

function makeRatchetSession(): RatchetSessionRecord {
  return {
    sessionKey: 'peer-1:device-1',
    state: new Uint8Array([13, 14, 15]),
    updatedAt: 2_000,
  }
}

function makeDevice(): DeviceRecord {
  return {
    id: 'device-1',
    userId: 'user-1',
    deviceName: 'MacBook',
    platform: 'desktop',
    createdAt: 1_000,
    isCurrentDevice: true,
  }
}

function makeAttachment(): AttachmentRecord {
  return {
    mediaId: 'media-1',
    kind: 'image',
    originalName: 'photo.jpg',
    contentType: 'image/jpeg',
  }
}

describe('InMemoryStorageRuntime', () => {
  it('сохраняет и читает identity/signed prekey/deviceId', async () => {
    const storage = new InMemoryStorageRuntime()

    await storage.saveIdentityKey(makeIdentityKeyPair())
    await storage.saveSignedPreKey(makeSignedPreKey())
    await storage.saveCurrentDevice(makeDevice())
    await storage.saveDeviceId('device-1')

    expect(await storage.loadIdentityKey()).toEqual(makeIdentityKeyPair())
    expect(await storage.loadSignedPreKey()).toEqual(makeSignedPreKey())
    expect(await storage.loadCurrentDevice()).toEqual(makeDevice())
    expect(await storage.loadDeviceId()).toBe('device-1')
  })

  it('appendOneTimePreKeys добавляет новые ключи с инкрементальными id', async () => {
    const storage = new InMemoryStorageRuntime()

    const appended = await storage.appendOneTimePreKeys([
      { publicKey: new Uint8Array([1]), privateKey: new Uint8Array([2]) },
      { publicKey: new Uint8Array([3]), privateKey: new Uint8Array([4]) },
    ])

    expect(appended.map((key) => key.id)).toEqual([1, 2])
    const consumed = await storage.consumeOneTimePreKey(1)
    expect(consumed?.id).toBe(1)
    expect((await storage.loadOneTimePreKeys()).map((key) => key.id)).toEqual([2])
  })

  it('сохраняет ratchet session и sender keys по scoped key', async () => {
    const storage = new InMemoryStorageRuntime()

    await storage.saveRatchetSession(makeRatchetSession())
    await storage.saveMySenderKey('chat-1', 'my-sender-key')
    await storage.savePeerSenderKey('chat-1', 'user-2', 'peer-sender-key')

    expect(await storage.loadRatchetSession('peer-1:device-1')).toEqual(makeRatchetSession())
    expect(await storage.loadMySenderKey('chat-1')).toBe('my-sender-key')
    expect(await storage.loadPeerSenderKey('chat-1', 'user-2')).toBe('peer-sender-key')
  })

  it('поддерживает media/settings/push subscription persistence', async () => {
    const storage = new InMemoryStorageRuntime()
    const subscription = { endpoint: 'https://push.example/subscription' }

    await storage.saveAttachmentMetadata(makeAttachment())
    await storage.bindAttachment('media-1', 'chat-1')
    await storage.setSetting('serverUrl', 'https://messenger.local')
    await storage.savePushSubscription(subscription)

    expect(await storage.getAttachment('media-1')).toEqual({
      ...makeAttachment(),
      chatId: 'chat-1',
    })
    expect(await storage.getSetting('serverUrl')).toBe('https://messenger.local')
    expect(await storage.loadPushSubscription()).toEqual(subscription)
  })
})
