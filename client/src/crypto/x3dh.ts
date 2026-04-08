/**
 * X3DH (Extended Triple Diffie-Hellman) key agreement.
 * Реализует установку общего секрета по протоколу Signal.
 *
 * Ссылка: https://signal.org/docs/specifications/x3dh/
 *
 * Роли:
 *   Initiator (Alice) — тот, кто первым пишет сообщение
 *   Responder (Bob)   — тот, кому пишут
 */

import _sodium from 'libsodium-wrappers'
import type { PublicKeyBundle } from '@/types'
import type { DHKeyPair, IdentityKeyPair } from './keystore'

let sodium: typeof _sodium

export async function initSodium(): Promise<void> {
  await _sodium.ready
  sodium = _sodium
}

export interface X3DHResult {
  sharedSecret: Uint8Array          // 32-байтный SK для инициализации Double Ratchet
  ephemeralKeyPublic: Uint8Array    // EK_A.public — нужно передать Бобу
  usedOpkId?: number                // ID использованного одноразового ключа
}

/**
 * Initiator side (Alice).
 * Вычисляет общий секрет по публичным ключам Боба.
 */
export function x3dhInitiatorAgreement(
  aliceIdentity: IdentityKeyPair,          // IK_A
  aliceEphemeral: DHKeyPair,               // EK_A (генерируется каждый раз)
  bobBundle: PublicKeyBundle               // IK_B, SPK_B, OPK_B с сервера
): X3DHResult {
  // Конвертируем Ed25519 → X25519 для DH операций
  const aliceIKX = sodium.crypto_sign_ed25519_sk_to_curve25519(aliceIdentity.privateKey)
  const bobIKX = sodium.crypto_sign_ed25519_pk_to_curve25519(fromBase64(bobBundle.ikPublic))
  const bobSPK = fromBase64(bobBundle.spkPublic)

  // DH1 = DH(IK_A, SPK_B)
  const dh1 = sodium.crypto_scalarmult(aliceIKX, bobSPK)
  // DH2 = DH(EK_A, IK_B)
  const dh2 = sodium.crypto_scalarmult(aliceEphemeral.privateKey, bobIKX)
  // DH3 = DH(EK_A, SPK_B)
  const dh3 = sodium.crypto_scalarmult(aliceEphemeral.privateKey, bobSPK)

  let inputKeyMaterial: Uint8Array

  if (bobBundle.opkPublic && bobBundle.opkId !== undefined) {
    const bobOPK = fromBase64(bobBundle.opkPublic)
    // DH4 = DH(EK_A, OPK_B)
    const dh4 = sodium.crypto_scalarmult(aliceEphemeral.privateKey, bobOPK)
    inputKeyMaterial = concat(dh1, dh2, dh3, dh4)
  } else {
    inputKeyMaterial = concat(dh1, dh2, dh3)
  }

  const sharedSecret = kdf(inputKeyMaterial)

  return {
    sharedSecret,
    ephemeralKeyPublic: aliceEphemeral.publicKey,
    usedOpkId: bobBundle.opkId
  }
}

/**
 * Responder side (Bob).
 * Воспроизводит те же DH операции по данным инициатора.
 */
export function x3dhResponderAgreement(
  bobIdentity: IdentityKeyPair,            // IK_B
  bobSignedPreKey: DHKeyPair,              // SPK_B
  bobOneTimePreKey: DHKeyPair | undefined, // OPK_B
  aliceIKPublic: Uint8Array,              // IK_A.public — из первого сообщения
  aliceEKPublic: Uint8Array               // EK_A.public — из первого сообщения
): Uint8Array {
  const bobIKX = sodium.crypto_sign_ed25519_sk_to_curve25519(bobIdentity.privateKey)
  const aliceIKX = sodium.crypto_sign_ed25519_pk_to_curve25519(aliceIKPublic)

  // DH1 = DH(SPK_B, IK_A)
  const dh1 = sodium.crypto_scalarmult(bobSignedPreKey.privateKey, aliceIKX)
  // DH2 = DH(IK_B, EK_A)
  const dh2 = sodium.crypto_scalarmult(bobIKX, aliceEKPublic)
  // DH3 = DH(SPK_B, EK_A)
  const dh3 = sodium.crypto_scalarmult(bobSignedPreKey.privateKey, aliceEKPublic)

  let inputKeyMaterial: Uint8Array

  if (bobOneTimePreKey) {
    // DH4 = DH(OPK_B, EK_A)
    const dh4 = sodium.crypto_scalarmult(bobOneTimePreKey.privateKey, aliceEKPublic)
    inputKeyMaterial = concat(dh1, dh2, dh3, dh4)
  } else {
    inputKeyMaterial = concat(dh1, dh2, dh3)
  }

  return kdf(inputKeyMaterial)
}

/** Генерация X25519 ключевой пары для эфемерного/одноразового ключа */
export function generateDHKeyPair(id = 0): DHKeyPair {
  const { publicKey, privateKey } = sodium.crypto_kx_keypair()
  return { id, publicKey, privateKey }
}

/** Генерация Ed25519 identity key pair */
export function generateIdentityKeyPair(): IdentityKeyPair {
  return sodium.crypto_sign_keypair()
}

/** Подписать данные Ed25519 */
export function signData(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(data, privateKey)
}

/** Проверить Ed25519 подпись */
export function verifySignature(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return sodium.crypto_sign_verify_detached(signature, data, publicKey)
}

// ── Helpers ───────────────────────────────────────────────

function kdf(inputKeyMaterial: Uint8Array): Uint8Array {
  // HKDF-like: используем crypto_generichash (BLAKE2b) как PRF
  // В продакшене следует применить настоящий HKDF через SubtleCrypto
  return sodium.crypto_generichash(32, inputKeyMaterial)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

export function toBase64(data: Uint8Array): string {
  return sodium.to_base64(data)
}

export function fromBase64(b64: string): Uint8Array {
  return sodium.from_base64(b64)
}
