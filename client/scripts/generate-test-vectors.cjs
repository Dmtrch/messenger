// client/scripts/generate-test-vectors.cjs
// Запускать: node client/scripts/generate-test-vectors.cjs
'use strict'

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const sodium = require('libsodium-wrappers')

async function main() {
  await sodium.ready

  const outDir = join(__dirname, '../../shared/test-vectors')
  mkdirSync(outDir, { recursive: true })

  // --- X3DH vector ---
  // Стандартный Signal X3DH: Alice-initiator
  const aliceIK = sodium.crypto_sign_keypair()      // ed25519 identity key
  const aliceEK = sodium.crypto_box_keypair()        // curve25519 ephemeral key

  const bobIK = sodium.crypto_sign_keypair()         // ed25519 identity key
  const bobSPK = sodium.crypto_box_keypair()         // curve25519 signed pre-key
  const bobOPK = sodium.crypto_box_keypair()         // curve25519 one-time pre-key

  // Конвертируем ed25519 → curve25519
  const aliceIKCurvePriv = sodium.crypto_sign_ed25519_sk_to_curve25519(aliceIK.privateKey)
  const bobIKCurvePub = sodium.crypto_sign_ed25519_pk_to_curve25519(bobIK.publicKey)

  // Стандартные DH-операции X3DH
  // DH1 = Alice_IK_curve × Bob_SPK
  const dh1 = sodium.crypto_scalarmult(aliceIKCurvePriv, bobSPK.publicKey)
  // DH2 = Alice_EK × Bob_IK_curve
  const dh2 = sodium.crypto_scalarmult(aliceEK.privateKey, bobIKCurvePub)
  // DH3 = Alice_EK × Bob_SPK
  const dh3 = sodium.crypto_scalarmult(aliceEK.privateKey, bobSPK.publicKey)
  // DH4 = Alice_EK × Bob_OPK
  const dh4 = sodium.crypto_scalarmult(aliceEK.privateKey, bobOPK.publicKey)

  const combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length)
  combined.set(dh1, 0)
  combined.set(dh2, dh1.length)
  combined.set(dh3, dh1.length + dh2.length)
  combined.set(dh4, dh1.length + dh2.length + dh3.length)

  const sharedSecret = sodium.crypto_generichash(32, combined)

  const x3dhVector = {
    aliceIdentityKeyPair: {
      publicKey: Buffer.from(aliceIK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceIK.privateKey).toString('base64'),
    },
    aliceEphemeralKeyPair: {
      publicKey: Buffer.from(aliceEK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceEK.privateKey).toString('base64'),
    },
    bobIdentityKeyPair: {
      publicKey: Buffer.from(bobIK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobIK.privateKey).toString('base64'),
    },
    bobSignedPreKey: {
      publicKey: Buffer.from(bobSPK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobSPK.privateKey).toString('base64'),
    },
    bobOneTimePreKey: {
      publicKey: Buffer.from(bobOPK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobOPK.privateKey).toString('base64'),
    },
    expectedSharedSecret: Buffer.from(sharedSecret).toString('base64'),
  }
  writeFileSync(join(outDir, 'x3dh.json'), JSON.stringify(x3dhVector, null, 2))

  // --- Ratchet vector ---
  const rootKey = sodium.randombytes_buf(32)
  const chainKey = sodium.randombytes_buf(32)
  const msgKey = sodium.crypto_kdf_derive_from_key(32, 1, 'msg_key_', chainKey)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const plaintext = new TextEncoder().encode('hello ratchet')
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, msgKey)

  const ratchetVector = {
    rootKey: Buffer.from(rootKey).toString('base64'),
    chainKey: Buffer.from(chainKey).toString('base64'),
    messageIndex: 1,
    nonce: Buffer.from(nonce).toString('base64'),
    plaintext: 'hello ratchet',
    expectedCiphertext: Buffer.from(ciphertext).toString('base64'),
    expectedMsgKey: Buffer.from(msgKey).toString('base64'),
  }
  writeFileSync(join(outDir, 'ratchet.json'), JSON.stringify(ratchetVector, null, 2))

  // --- SenderKey vector ---
  const senderKey = sodium.randombytes_buf(32)
  const skNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const skPlaintext = new TextEncoder().encode('hello group')
  const skCiphertext = sodium.crypto_secretbox_easy(skPlaintext, skNonce, senderKey)

  const senderKeyVector = {
    senderKey: Buffer.from(senderKey).toString('base64'),
    nonce: Buffer.from(skNonce).toString('base64'),
    plaintext: 'hello group',
    expectedCiphertext: Buffer.from(skCiphertext).toString('base64'),
  }
  writeFileSync(join(outDir, 'sender-key.json'), JSON.stringify(senderKeyVector, null, 2))

  console.log('✅ Test vectors written to shared/test-vectors/')
}

main().catch(console.error)
