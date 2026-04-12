/**
 * Тесты X3DH: initiator/responder handshake, совпадение shared secret.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import _sodium from 'libsodium-wrappers'
import {
  initSodium,
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
  generateDHKeyPair,
  generateIdentityKeyPair,
  signData,
  verifySignature,
  toBase64,
} from './x3dh'
import type { PublicKeyBundle } from '@/types'

beforeAll(async () => {
  await initSodium()
})

// ── Полный X3DH handshake ─────────────────────────────────────────────────────

describe('X3DH handshake', () => {
  it('Initiator и responder получают одинаковый shared secret (без OPK)', () => {
    const s = _sodium

    // Bob генерирует свои ключи
    const bobIK = generateIdentityKeyPair()
    const bobSPK = generateDHKeyPair(1)
    const spkSignature = signData(bobSPK.publicKey, bobIK.privateKey)

    // Alice генерирует свои ключи
    const aliceIK = generateIdentityKeyPair()
    const aliceEK = generateDHKeyPair(0)

    // Bundle Боба (как отдаётся сервером)
    const bobBundle: PublicKeyBundle = {
      userId: 'bob',
      ikPublic: toBase64(bobIK.publicKey),
      spkId: 1,
      spkPublic: toBase64(bobSPK.publicKey),
      spkSignature: toBase64(spkSignature),
      // opkId, opkPublic отсутствуют
    }

    // Alice вычисляет общий секрет (initiator side)
    const aliceResult = x3dhInitiatorAgreement(aliceIK, aliceEK, bobBundle)

    // Bob вычисляет общий секрет (responder side)
    const bobSharedSecret = x3dhResponderAgreement(
      bobIK,
      bobSPK,
      undefined,           // без OPK
      aliceIK.publicKey,   // IK_A.public
      aliceEK.publicKey    // EK_A.public
    )

    // Shared secrets должны совпасть
    expect(aliceResult.sharedSecret).toEqual(bobSharedSecret)
  })

  it('Initiator и responder получают одинаковый shared secret (с OPK)', () => {
    const bobIK = generateIdentityKeyPair()
    const bobSPK = generateDHKeyPair(1)
    const bobOPK = generateDHKeyPair(42)
    const spkSignature = signData(bobSPK.publicKey, bobIK.privateKey)

    const aliceIK = generateIdentityKeyPair()
    const aliceEK = generateDHKeyPair(0)

    const bobBundle: PublicKeyBundle = {
      userId: 'bob',
      ikPublic: toBase64(bobIK.publicKey),
      spkId: 1,
      spkPublic: toBase64(bobSPK.publicKey),
      spkSignature: toBase64(spkSignature),
      opkId: 42,
      opkPublic: toBase64(bobOPK.publicKey),
    }

    const aliceResult = x3dhInitiatorAgreement(aliceIK, aliceEK, bobBundle)
    const bobSharedSecret = x3dhResponderAgreement(
      bobIK, bobSPK, bobOPK,
      aliceIK.publicKey, aliceEK.publicKey
    )

    expect(aliceResult.sharedSecret).toEqual(bobSharedSecret)
    expect(aliceResult.usedOpkId).toBe(42)
  })

  it('Разные ephemeral keys → разные shared secrets', () => {
    const bobIK = generateIdentityKeyPair()
    const bobSPK = generateDHKeyPair(1)
    const spkSig = signData(bobSPK.publicKey, bobIK.privateKey)

    const aliceIK = generateIdentityKeyPair()
    const ek1 = generateDHKeyPair(0)
    const ek2 = generateDHKeyPair(0)

    const bundle: PublicKeyBundle = {
      userId: 'bob',
      ikPublic: toBase64(bobIK.publicKey),
      spkId: 1,
      spkPublic: toBase64(bobSPK.publicKey),
      spkSignature: toBase64(spkSig),
    }

    const r1 = x3dhInitiatorAgreement(aliceIK, ek1, bundle)
    const r2 = x3dhInitiatorAgreement(aliceIK, ek2, bundle)

    expect(r1.sharedSecret).not.toEqual(r2.sharedSecret)
  })

  it('Неверный OPK на стороне responder → другой shared secret', () => {
    const bobIK = generateIdentityKeyPair()
    const bobSPK = generateDHKeyPair(1)
    const bobOPK = generateDHKeyPair(42)
    const wrongOPK = generateDHKeyPair(99) // другой OPK
    const spkSig = signData(bobSPK.publicKey, bobIK.privateKey)

    const aliceIK = generateIdentityKeyPair()
    const aliceEK = generateDHKeyPair(0)

    const bundle: PublicKeyBundle = {
      userId: 'bob',
      ikPublic: toBase64(bobIK.publicKey),
      spkId: 1,
      spkPublic: toBase64(bobSPK.publicKey),
      spkSignature: toBase64(spkSig),
      opkId: 42,
      opkPublic: toBase64(bobOPK.publicKey),
    }

    const aliceResult = x3dhInitiatorAgreement(aliceIK, aliceEK, bundle)
    const wrongResult = x3dhResponderAgreement(
      bobIK, bobSPK, wrongOPK, // неверный OPK
      aliceIK.publicKey, aliceEK.publicKey
    )

    expect(aliceResult.sharedSecret).not.toEqual(wrongResult)
  })
})

// ── SPK signature ─────────────────────────────────────────────────────────────

describe('SPK signature verification', () => {
  it('Верная подпись SPK проходит проверку', () => {
    const ik = generateIdentityKeyPair()
    const spk = generateDHKeyPair(1)
    const sig = signData(spk.publicKey, ik.privateKey)
    expect(verifySignature(spk.publicKey, sig, ik.publicKey)).toBe(true)
  })

  it('Подпись другого ключа не проходит проверку', () => {
    const ik = generateIdentityKeyPair()
    const spk = generateDHKeyPair(1)
    const otherKey = generateDHKeyPair(2)
    const sig = signData(spk.publicKey, ik.privateKey)
    expect(verifySignature(otherKey.publicKey, sig, ik.publicKey)).toBe(false)
  })
})
