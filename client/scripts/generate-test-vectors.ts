// client/scripts/generate-test-vectors.ts
// Запускать: node client/scripts/generate-test-vectors.cjs
// (ESM-версия libsodium не содержит libsodium.mjs, поэтому используйте .cjs вариант)
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sodium from 'libsodium-wrappers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  await sodium.ready

  const outDir = join(__dirname, '../../shared/test-vectors')
  mkdirSync(outDir, { recursive: true })

  // --- X3DH vector ---
  const aliceIK = sodium.crypto_sign_keypair()
  const aliceSPK = sodium.crypto_box_keypair()
  const aliceOPK = sodium.crypto_box_keypair()
  const bobIK = sodium.crypto_sign_keypair()
  const bobSPK = sodium.crypto_box_keypair()

  // Alice IK ed→curve
  const aliceIKCurve = {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(aliceIK.publicKey),
    privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(aliceIK.privateKey),
  }
  const bobIKCurve = {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(bobIK.publicKey),
    privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(bobIK.privateKey),
  }

  // DH1 = DH(Alice_IK_curve, Bob_SPK)
  const dh1 = sodium.crypto_scalarmult(aliceIKCurve.privateKey, bobSPK.publicKey)
  // DH2 = DH(Alice_SPK, Bob_IK_curve)
  const dh2 = sodium.crypto_scalarmult(aliceSPK.privateKey, bobIKCurve.publicKey)
  // DH3 = DH(Alice_SPK, Bob_SPK)
  const dh3 = sodium.crypto_scalarmult(aliceSPK.privateKey, bobSPK.publicKey)
  // DH4 = DH(Alice_OPK, Bob_SPK)
  const dh4 = sodium.crypto_scalarmult(aliceOPK.privateKey, bobSPK.publicKey)

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
    aliceSignedPreKey: {
      publicKey: Buffer.from(aliceSPK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceSPK.privateKey).toString('base64'),
    },
    aliceOneTimePreKey: {
      publicKey: Buffer.from(aliceOPK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceOPK.privateKey).toString('base64'),
    },
    bobIdentityKeyPair: {
      publicKey: Buffer.from(bobIK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobIK.privateKey).toString('base64'),
    },
    bobSignedPreKey: {
      publicKey: Buffer.from(bobSPK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobSPK.privateKey).toString('base64'),
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
