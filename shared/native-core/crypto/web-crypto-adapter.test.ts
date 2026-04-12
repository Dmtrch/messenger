import { beforeAll, describe, expect, it } from 'vitest'

import { WebCryptoAdapter } from './web-crypto-adapter'

describe('WebCryptoAdapter', () => {
  let adapter: WebCryptoAdapter

  beforeAll(async () => {
    adapter = new WebCryptoAdapter()
    await adapter.ready()
  })

  it('строит совместимый X3DH bootstrap и даёт рабочий individual encrypt/decrypt round-trip', async () => {
    const aliceIdentity = adapter.generateIdentityKeyPair()
    const aliceEphemeral = adapter.generateEphemeralKeyPair()

    const bobIdentity = adapter.generateIdentityKeyPair()
    const bobSignedPreKey = adapter.generateSignedPreKey()
    const bobOneTimePreKey = adapter.generateSignedPreKey()
    const bobSignature = adapter.signPreKey(bobSignedPreKey.publicKey, bobIdentity.privateKey)

    const outbound = adapter.createOutboundSharedSecret({
      identityKeyPair: aliceIdentity,
      ephemeralKeyPair: aliceEphemeral,
      bundle: {
        deviceId: 'bob-device-1',
        ikPublic: bobIdentity.publicKey,
        spkId: bobSignedPreKey.id,
        spkPublic: bobSignedPreKey.publicKey,
        spkSignature: bobSignature,
        opkId: bobOneTimePreKey.id,
        opkPublic: bobOneTimePreKey.publicKey,
      },
    })

    const inbound = adapter.createInboundSharedSecret({
      identityKeyPair: bobIdentity,
      signedPreKey: bobSignedPreKey,
      oneTimePreKey: bobOneTimePreKey,
      senderIkPublic: aliceIdentity.publicKey,
      senderEkPublic: aliceEphemeral.publicKey,
    })

    expect(outbound.sharedSecret).toEqual(inbound)

    const aliceState = await adapter.initOutboundRatchet(
      outbound.sharedSecret,
      outbound.ratchetKeyPair,
      bobSignedPreKey.publicKey,
    )
    const bobState = await adapter.initInboundRatchet(
      inbound,
      bobSignedPreKey,
      aliceEphemeral.publicKey,
    )

    const encrypted = await adapter.encryptMessage(aliceState, 'hello-real-adapter')
    const decrypted = await adapter.decryptMessage(bobState, encrypted.ciphertext)

    expect(decrypted.plaintext).toBe('hello-real-adapter')
  })

  it('Sender Key distribution импортируется и позволяет расшифровать group message', async () => {
    const senderState = await adapter.generateSenderKey()
    const distribution = adapter.createSenderKeyDistribution('alice', 'chat-1', senderState)
    const imported = adapter.importSenderKeyDistribution(distribution)

    const encrypted = await adapter.encryptGroupMessage(senderState, 'chat-1', 'hello-group-real')
    const decrypted = await adapter.decryptGroupMessage(imported, encrypted.payload)

    expect(decrypted.plaintext).toBe('hello-group-real')
  })
})
