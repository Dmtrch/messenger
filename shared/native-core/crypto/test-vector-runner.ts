import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { WebCryptoAdapter } from './web-crypto-adapter'

interface VectorManifestEntry {
  id: string
  file: string
  suite: string
  status: string
}

interface VectorManifest {
  version: number
  description: string
  vectors: VectorManifestEntry[]
}

function vectorPath(file: string): string {
  return path.resolve(process.cwd(), '..', 'shared', 'test-vectors', file)
}

async function readJson<T>(file: string): Promise<T> {
  const content = await readFile(vectorPath(file), 'utf8')
  return JSON.parse(content) as T
}

export async function loadVectorManifest(): Promise<VectorManifest> {
  return readJson<VectorManifest>('manifest.json')
}

export async function runX3DHSeedVector(adapter: WebCryptoAdapter): Promise<{
  matchesSharedSecret: boolean
  deviceScoped: boolean
}> {
  const vector = await readJson<{
    inputs: Array<{ name: string; value: { userId: string; deviceId: string } | unknown }>
  }>('x3dh-handshake-vector.json')

  const initiator = vector.inputs.find((entry) => entry.name === 'initiator-device')?.value as {
    userId: string
    deviceId: string
  }
  const responder = vector.inputs.find((entry) => entry.name === 'responder-device')?.value as {
    userId: string
    deviceId: string
  }

  const aliceIdentity = adapter.generateIdentityKeyPair()
  const aliceEphemeral = adapter.generateEphemeralKeyPair()
  const bobIdentity = adapter.generateIdentityKeyPair()
  const bobSignedPreKey = adapter.generateSignedPreKey()
  const bobSignature = adapter.signPreKey(bobSignedPreKey.publicKey, bobIdentity.privateKey)

  const outbound = adapter.createOutboundSharedSecret({
    identityKeyPair: aliceIdentity,
    ephemeralKeyPair: aliceEphemeral,
    bundle: {
      deviceId: responder.deviceId,
      ikPublic: bobIdentity.publicKey,
      spkId: bobSignedPreKey.id,
      spkPublic: bobSignedPreKey.publicKey,
      spkSignature: bobSignature,
    },
  })

  const inbound = adapter.createInboundSharedSecret({
    identityKeyPair: bobIdentity,
    signedPreKey: bobSignedPreKey,
    oneTimePreKey: null,
    senderIkPublic: aliceIdentity.publicKey,
    senderEkPublic: aliceEphemeral.publicKey,
  })

  return {
    matchesSharedSecret: thisUint8ArraysEqual(outbound.sharedSecret, inbound),
    deviceScoped: initiator.deviceId !== responder.deviceId,
  }
}

export async function runDoubleRatchetSeedVector(adapter: WebCryptoAdapter): Promise<{
  decryptedOrder: string[]
  outOfOrderSupported: boolean
}> {
  const vector = await readJson<{
    inputs: Array<{ name: string; value: string[] | { sender: string; receiver: string } }>
  }>('double-ratchet-sequence-vector.json')

  const messages = vector.inputs.find((entry) => entry.name === 'message-sequence')?.value as string[]
  const deliveryOrder = vector.inputs.find((entry) => entry.name === 'delivery-order')?.value as string[]

  const aliceIdentity = adapter.generateIdentityKeyPair()
  const aliceEphemeral = adapter.generateEphemeralKeyPair()
  const bobIdentity = adapter.generateIdentityKeyPair()
  const bobSignedPreKey = adapter.generateSignedPreKey()
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
    },
  })
  const inbound = adapter.createInboundSharedSecret({
    identityKeyPair: bobIdentity,
    signedPreKey: bobSignedPreKey,
    oneTimePreKey: null,
    senderIkPublic: aliceIdentity.publicKey,
    senderEkPublic: aliceEphemeral.publicKey,
  })

  let aliceState = await adapter.initOutboundRatchet(
    outbound.sharedSecret,
    outbound.ratchetKeyPair,
    bobSignedPreKey.publicKey,
  )
  let bobState = await adapter.initInboundRatchet(
    inbound,
    bobSignedPreKey,
    aliceEphemeral.publicKey,
  )

  const encryptedByPlaintext = new Map<string, Uint8Array>()
  for (const plaintext of messages) {
    const encrypted = await adapter.encryptMessage(aliceState, plaintext)
    aliceState = encrypted.nextState
    encryptedByPlaintext.set(plaintext, encrypted.ciphertext)
  }

  const decryptedOrder: string[] = []
  for (const plaintext of deliveryOrder) {
    const ciphertext = encryptedByPlaintext.get(plaintext)
    if (!ciphertext) throw new Error(`Missing ciphertext for ${plaintext}`)
    const decrypted = await adapter.decryptMessage(bobState, ciphertext)
    bobState = decrypted.nextState
    decryptedOrder.push(decrypted.plaintext)
  }

  return {
    decryptedOrder,
    outOfOrderSupported: decryptedOrder.join('|') === deliveryOrder.join('|'),
  }
}

export async function runSenderKeySeedVector(adapter: WebCryptoAdapter): Promise<{
  decryptedPayload: string
  distributionCompatible: boolean
}> {
  const vector = await readJson<{
    inputs: Array<{ name: string; value: string | string[] }>
  }>('sender-key-group-vector.json')

  const members = vector.inputs.find((entry) => entry.name === 'group-members')?.value as string[]
  const payload = vector.inputs.find((entry) => entry.name === 'group-payload')?.value as string

  const senderState = await adapter.generateSenderKey()
  const distribution = adapter.createSenderKeyDistribution(members[0] ?? 'alice-device-1', 'chat-1', senderState)
  const imported = adapter.importSenderKeyDistribution(distribution)
  const encrypted = await adapter.encryptGroupMessage(senderState, 'chat-1', payload)
  const decrypted = await adapter.decryptGroupMessage(imported, encrypted.payload)

  return {
    decryptedPayload: decrypted.plaintext,
    distributionCompatible: !!distribution.signingPublicKey && distribution.chatId === 'chat-1',
  }
}

function thisUint8ArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
