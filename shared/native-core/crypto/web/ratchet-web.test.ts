import { beforeAll, describe, expect, it } from 'vitest'

import {
  deserializeRatchetState,
  initRatchet,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeRatchetState,
  type RatchetState,
} from './ratchet-web'
import libsodium from '../../../../client/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'

async function makeSession(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  const sharedSecret = libsodium.randombytes_buf(32)
  const aliceDHKeyPair = libsodium.crypto_kx_keypair()
  const bobDHKeyPair = libsodium.crypto_kx_keypair()

  const alice = await initRatchet(sharedSecret, aliceDHKeyPair, bobDHKeyPair.publicKey, true)
  const bob = await initRatchet(sharedSecret, bobDHKeyPair, null, false)

  return { alice, bob }
}

describe('shared web ratchet helper', () => {
  beforeAll(async () => {
    await libsodium.ready
  })

  it('делает encrypt/decrypt round-trip', async () => {
    const { alice, bob } = await makeSession()

    const encrypted = await ratchetEncrypt(alice, 'hello-ratchet-web')
    const decrypted = await ratchetDecrypt(bob, encrypted.message)

    expect(decrypted.plaintext).toBe('hello-ratchet-web')
  })

  it('сохраняет состояние через serialize/deserialize', async () => {
    const { alice, bob } = await makeSession()
    const encrypted = await ratchetEncrypt(alice, 'persist-ratchet')
    const restored = deserializeRatchetState(serializeRatchetState(bob))
    const decrypted = await ratchetDecrypt(restored, encrypted.message)

    expect(decrypted.plaintext).toBe('persist-ratchet')
  })
})
