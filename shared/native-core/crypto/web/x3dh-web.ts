import _sodium from '../../../../client/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'

export interface IdentityKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface DHKeyPair {
  id: number
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface PublicKeyBundle {
  ikPublic: Uint8Array | string
  spkId: number
  spkPublic: Uint8Array | string
  spkSignature: Uint8Array | string
  opkId?: number
  opkPublic?: Uint8Array | string
}

let sodium: typeof _sodium

export async function initSodium(): Promise<void> {
  await _sodium.ready
  sodium = _sodium
}

export interface X3DHResult {
  sharedSecret: Uint8Array
  ephemeralKeyPublic: Uint8Array
  usedOpkId?: number
}

export function x3dhInitiatorAgreement(
  aliceIdentity: IdentityKeyPair,
  aliceEphemeral: DHKeyPair,
  bobBundle: PublicKeyBundle,
): X3DHResult {
  const aliceIKX = sodium.crypto_sign_ed25519_sk_to_curve25519(aliceIdentity.privateKey)
  const bobIKX = sodium.crypto_sign_ed25519_pk_to_curve25519(asBytes(bobBundle.ikPublic))
  const bobSPK = asBytes(bobBundle.spkPublic)

  const dh1 = sodium.crypto_scalarmult(aliceIKX, bobSPK)
  const dh2 = sodium.crypto_scalarmult(aliceEphemeral.privateKey, bobIKX)
  const dh3 = sodium.crypto_scalarmult(aliceEphemeral.privateKey, bobSPK)

  const inputKeyMaterial = bobBundle.opkPublic && bobBundle.opkId !== undefined
    ? concat(dh1, dh2, dh3, sodium.crypto_scalarmult(aliceEphemeral.privateKey, asBytes(bobBundle.opkPublic)))
    : concat(dh1, dh2, dh3)

  return {
    sharedSecret: kdf(inputKeyMaterial),
    ephemeralKeyPublic: aliceEphemeral.publicKey,
    usedOpkId: bobBundle.opkId,
  }
}

export function x3dhResponderAgreement(
  bobIdentity: IdentityKeyPair,
  bobSignedPreKey: DHKeyPair,
  bobOneTimePreKey: DHKeyPair | undefined,
  aliceIKPublic: Uint8Array,
  aliceEKPublic: Uint8Array,
): Uint8Array {
  const bobIKX = sodium.crypto_sign_ed25519_sk_to_curve25519(bobIdentity.privateKey)
  const aliceIKX = sodium.crypto_sign_ed25519_pk_to_curve25519(aliceIKPublic)

  const dh1 = sodium.crypto_scalarmult(bobSignedPreKey.privateKey, aliceIKX)
  const dh2 = sodium.crypto_scalarmult(bobIKX, aliceEKPublic)
  const dh3 = sodium.crypto_scalarmult(bobSignedPreKey.privateKey, aliceEKPublic)

  const inputKeyMaterial = bobOneTimePreKey
    ? concat(dh1, dh2, dh3, sodium.crypto_scalarmult(bobOneTimePreKey.privateKey, aliceEKPublic))
    : concat(dh1, dh2, dh3)

  return kdf(inputKeyMaterial)
}

export function generateDHKeyPair(id = 0): DHKeyPair {
  const { publicKey, privateKey } = sodium.crypto_kx_keypair()
  return { id, publicKey, privateKey }
}

export function generateIdentityKeyPair(): IdentityKeyPair {
  return sodium.crypto_sign_keypair()
}

export function signData(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(data, privateKey)
}

export function verifySignature(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return sodium.crypto_sign_verify_detached(signature, data, publicKey)
}

export function toBase64(data: Uint8Array): string {
  return sodium.to_base64(data)
}

export function fromBase64(b64: string): Uint8Array {
  return sodium.from_base64(b64)
}

function asBytes(value: Uint8Array | string | undefined): Uint8Array {
  if (!value) throw new Error('Missing key material')
  return typeof value === 'string' ? fromBase64(value) : value
}

function kdf(inputKeyMaterial: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(32, inputKeyMaterial, null)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, current) => sum + current.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }
  return result
}
