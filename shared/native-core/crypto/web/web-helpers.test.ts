import { beforeAll, describe, expect, it } from 'vitest'

import {
  generateDHKeyPair,
  generateIdentityKeyPair,
  initSodium,
  signData,
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
} from './x3dh-web'
import {
  generateSenderKey,
  senderKeyDecrypt,
  senderKeyEncrypt,
} from './senderkey-web'

describe('shared web crypto helpers', () => {
  beforeAll(async () => {
    await initSodium()
  })

  it('x3dh-web выполняет совместимый handshake без client/src/crypto/x3dh.ts', () => {
    const bobIdentity = generateIdentityKeyPair()
    const bobSignedPreKey = generateDHKeyPair(1)
    const bobSignature = signData(bobSignedPreKey.publicKey, bobIdentity.privateKey)

    const aliceIdentity = generateIdentityKeyPair()
    const aliceEphemeral = generateDHKeyPair(2)

    const outbound = x3dhInitiatorAgreement(aliceIdentity, aliceEphemeral, {
      ikPublic: bobIdentity.publicKey,
      spkId: 1,
      spkPublic: bobSignedPreKey.publicKey,
      spkSignature: bobSignature,
    })

    const inbound = x3dhResponderAgreement(
      bobIdentity,
      bobSignedPreKey,
      undefined,
      aliceIdentity.publicKey,
      aliceEphemeral.publicKey,
    )

    expect(outbound.sharedSecret).toEqual(inbound)
  })

  it('senderkey-web шифрует и расшифровывает group payload без client/src/crypto/senderkey.ts', async () => {
    const senderKey = await generateSenderKey()
    const encrypted = await senderKeyEncrypt(senderKey, 'chat-1', 'hello-web-helper')
    const decrypted = await senderKeyDecrypt(senderKey, encrypted.payload)

    expect(decrypted.plaintext).toBe('hello-web-helper')
  })
})
