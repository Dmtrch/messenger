/**
 * Double Ratchet — шифрование сообщений после X3DH.
 *
 * Реализует Double Ratchet по спецификации Signal:
 * - Симметричный рэтчет (chain key → message key)
 * - DH рэтчет при смене ключей удалённой стороны (два шага, как в spec)
 * - Кэш пропущенных ключей для out-of-order доставки
 */

import _sodium from '../../../../client/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'

type SodiumWithHmac = typeof _sodium & {
  crypto_auth_hmacsha256(message: Uint8Array, key: Uint8Array): Uint8Array
}

let sodium: SodiumWithHmac

async function getSodium(): Promise<SodiumWithHmac> {
  if (!sodium) {
    await _sodium.ready
    sodium = _sodium as SodiumWithHmac
  }
  return sodium
}

const MAX_SKIP = 100
const SKIPPED_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SkippedKeyEntry {
  key: string
  storedAt: number
}

export interface RatchetState {
  dhSendKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }
  dhRemotePublic: Uint8Array | null
  rootKey: Uint8Array
  sendChainKey: Uint8Array | null
  recvChainKey: Uint8Array | null
  sendCount: number
  recvCount: number
  prevSendCount: number
  skippedKeys: Record<string, SkippedKeyEntry>
}

export interface EncryptedMessage {
  header: {
    dhPublic: string
    n: number
    pn: number
  }
  ciphertext: string
}

export async function initRatchet(
  sharedSecret: Uint8Array,
  ourDHKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
  theirDHPublic: Uint8Array | null,
  isInitiator: boolean,
): Promise<RatchetState> {
  const s = await getSodium()

  if (isInitiator) {
    if (!theirDHPublic) throw new Error('Initiator requires remote DH public key')
    const dhOutput = s.crypto_scalarmult(ourDHKeyPair.privateKey, theirDHPublic)
    const derived = deriveKeys(s, dhOutput, sharedSecret)
    return {
      dhSendKeyPair: ourDHKeyPair,
      dhRemotePublic: theirDHPublic,
      rootKey: derived.rootKey,
      sendChainKey: derived.chainKey,
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      prevSendCount: 0,
      skippedKeys: {},
    }
  }

  return {
    dhSendKeyPair: ourDHKeyPair,
    dhRemotePublic: null,
    rootKey: sharedSecret,
    sendChainKey: null,
    recvChainKey: null,
    sendCount: 0,
    recvCount: 0,
    prevSendCount: 0,
    skippedKeys: {},
  }
}

export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
): Promise<{ message: EncryptedMessage; nextState: RatchetState }> {
  const s = await getSodium()
  if (!state.sendChainKey) throw new Error('No send chain key initialized')

  const { messageKey, nextChainKey } = advanceChain(s, state.sendChainKey)
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES)
  const ct = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, messageKey)
  const combined = new Uint8Array(nonce.length + ct.length)
  combined.set(nonce)
  combined.set(ct, nonce.length)

  return {
    message: {
      header: {
        dhPublic: s.to_base64(state.dhSendKeyPair.publicKey),
        n: state.sendCount,
        pn: state.prevSendCount,
      },
      ciphertext: s.to_base64(combined),
    },
    nextState: {
      ...state,
      sendChainKey: nextChainKey,
      sendCount: state.sendCount + 1,
    },
  }
}

export async function ratchetDecrypt(
  state: RatchetState,
  message: EncryptedMessage,
): Promise<{ plaintext: string; nextState: RatchetState }> {
  const s = await getSodium()
  const incomingDH = s.from_base64(message.header.dhPublic)
  const dhPubB64 = message.header.dhPublic
  const n = message.header.n
  const pn = message.header.pn ?? 0
  const freshSkipped = purgeExpiredSkippedKeys(state.skippedKeys)
  const skipKey = `${dhPubB64}:${n}`

  if (freshSkipped[skipKey]) {
    const messageKey = s.from_base64(freshSkipped[skipKey].key)
    const nextSkipped = { ...freshSkipped }
    delete nextSkipped[skipKey]
    return {
      plaintext: decryptWithKey(s, message, messageKey),
      nextState: { ...state, skippedKeys: nextSkipped },
    }
  }

  let currentState = { ...state, skippedKeys: freshSkipped }

  if (!currentState.dhRemotePublic || !arraysEqual(incomingDH, currentState.dhRemotePublic)) {
    currentState = skipMessageKeys(s, currentState, pn)
    currentState = await performDHRatchet(s, currentState, incomingDH)
  }

  currentState = skipMessageKeys(s, currentState, n)
  if (!currentState.recvChainKey) throw new Error('No receive chain key')

  const { messageKey, nextChainKey } = advanceChain(s, currentState.recvChainKey)
  return {
    plaintext: decryptWithKey(s, message, messageKey),
    nextState: {
      ...currentState,
      recvChainKey: nextChainKey,
      recvCount: n + 1,
    },
  }
}

export function serializeRatchetState(state: RatchetState): Uint8Array {
  const skippedKeys = purgeExpiredSkippedKeys(state.skippedKeys)
  return new TextEncoder().encode(JSON.stringify({
    dhSendKeyPair: {
      publicKey: Array.from(state.dhSendKeyPair.publicKey),
      privateKey: Array.from(state.dhSendKeyPair.privateKey),
    },
    dhRemotePublic: state.dhRemotePublic ? Array.from(state.dhRemotePublic) : null,
    rootKey: Array.from(state.rootKey),
    sendChainKey: state.sendChainKey ? Array.from(state.sendChainKey) : null,
    recvChainKey: state.recvChainKey ? Array.from(state.recvChainKey) : null,
    sendCount: state.sendCount,
    recvCount: state.recvCount,
    prevSendCount: state.prevSendCount,
    skippedKeys,
  }))
}

export function deserializeRatchetState(data: Uint8Array): RatchetState {
  const obj = JSON.parse(new TextDecoder().decode(data))
  const rawSkipped = (obj.skippedKeys ?? {}) as Record<string, string | SkippedKeyEntry>
  const now = Date.now()
  const skippedKeys: Record<string, SkippedKeyEntry> = {}
  for (const [key, value] of Object.entries(rawSkipped)) {
    skippedKeys[key] = typeof value === 'string'
      ? { key: value, storedAt: now }
      : value
  }

  return {
    dhSendKeyPair: {
      publicKey: new Uint8Array(obj.dhSendKeyPair.publicKey),
      privateKey: new Uint8Array(obj.dhSendKeyPair.privateKey),
    },
    dhRemotePublic: obj.dhRemotePublic ? new Uint8Array(obj.dhRemotePublic) : null,
    rootKey: new Uint8Array(obj.rootKey),
    sendChainKey: obj.sendChainKey ? new Uint8Array(obj.sendChainKey) : null,
    recvChainKey: obj.recvChainKey ? new Uint8Array(obj.recvChainKey) : null,
    sendCount: obj.sendCount,
    recvCount: obj.recvCount,
    prevSendCount: obj.prevSendCount ?? 0,
    skippedKeys,
  }
}

function purgeExpiredSkippedKeys(skippedKeys: Record<string, SkippedKeyEntry>): Record<string, SkippedKeyEntry> {
  const cutoff = Date.now() - SKIPPED_KEY_TTL_MS
  const result: Record<string, SkippedKeyEntry> = {}
  for (const [key, value] of Object.entries(skippedKeys)) {
    if (value.storedAt >= cutoff) result[key] = value
  }
  return result
}

function advanceChain(
  s: SodiumWithHmac,
  chainKey: Uint8Array,
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  return {
    messageKey: s.crypto_auth_hmacsha256(new Uint8Array([0x01]), chainKey),
    nextChainKey: s.crypto_auth_hmacsha256(new Uint8Array([0x02]), chainKey),
  }
}

function deriveKeys(
  s: SodiumWithHmac,
  inputKey: Uint8Array,
  salt: Uint8Array,
): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const okm = s.crypto_generichash(64, inputKey, salt)
  return {
    rootKey: okm.slice(0, 32),
    chainKey: okm.slice(32, 64),
  }
}

function skipMessageKeys(
  s: SodiumWithHmac,
  state: RatchetState,
  until: number,
): RatchetState {
  if (!state.recvChainKey || state.recvCount >= until) return state
  if (until - state.recvCount > MAX_SKIP) {
    throw new Error(`Too many skipped messages: ${until - state.recvCount}`)
  }

  const dhPubB64 = state.dhRemotePublic ? s.to_base64(state.dhRemotePublic) : 'none'
  const skippedKeys = { ...state.skippedKeys }
  let chainKey = state.recvChainKey
  let recvCount = state.recvCount
  const now = Date.now()

  while (recvCount < until) {
    const { messageKey, nextChainKey } = advanceChain(s, chainKey)
    skippedKeys[`${dhPubB64}:${recvCount}`] = { key: s.to_base64(messageKey), storedAt: now }
    chainKey = nextChainKey
    recvCount += 1

    if (Object.keys(skippedKeys).length > MAX_SKIP) {
      delete skippedKeys[Object.keys(skippedKeys)[0]]
    }
  }

  return { ...state, skippedKeys, recvChainKey: chainKey, recvCount }
}

async function performDHRatchet(
  s: SodiumWithHmac,
  state: RatchetState,
  theirNewDHPublic: Uint8Array,
): Promise<RatchetState> {
  const dhOutput1 = s.crypto_scalarmult(state.dhSendKeyPair.privateKey, theirNewDHPublic)
  const derived1 = deriveKeys(s, dhOutput1, state.rootKey)
  const newDHKeyPair = s.crypto_kx_keypair()
  const dhOutput2 = s.crypto_scalarmult(newDHKeyPair.privateKey, theirNewDHPublic)
  const derived2 = deriveKeys(s, dhOutput2, derived1.rootKey)

  return {
    ...state,
    dhSendKeyPair: newDHKeyPair,
    dhRemotePublic: theirNewDHPublic,
    rootKey: derived2.rootKey,
    recvChainKey: derived1.chainKey,
    sendChainKey: derived2.chainKey,
    sendCount: 0,
    recvCount: 0,
    prevSendCount: state.sendCount,
  }
}

function decryptWithKey(
  s: SodiumWithHmac,
  message: EncryptedMessage,
  messageKey: Uint8Array,
): string {
  const combined = s.from_base64(message.ciphertext)
  const nonce = combined.slice(0, s.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(s.crypto_secretbox_NONCEBYTES)
  return s.to_string(s.crypto_secretbox_open_easy(ct, nonce, messageKey))
}

function arraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
