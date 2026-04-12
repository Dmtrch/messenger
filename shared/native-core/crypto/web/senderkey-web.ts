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

export interface SenderKeyState {
  chainKey: Uint8Array
  iteration: number
  signingKeyPair: {
    publicKey: Uint8Array
    privateKey: Uint8Array
  }
}

export interface SKDistributionMessage {
  senderId: string
  chatId: string
  chainKey: string
  iteration: number
  signingPublicKey: string
}

export interface GroupWirePayload {
  v: 1
  type: 'group'
  chatId: string
  iteration: number
  sig: string
  ct: string
}

export async function generateSenderKey(): Promise<SenderKeyState> {
  const s = await getSodium()
  return {
    chainKey: s.randombytes_buf(32),
    iteration: 0,
    signingKeyPair: s.crypto_sign_keypair(),
  }
}

export async function senderKeyEncrypt(
  state: SenderKeyState,
  chatId: string,
  plaintext: string,
): Promise<{ payload: GroupWirePayload; nextState: SenderKeyState }> {
  const s = await getSodium()
  const { messageKey, nextChainKey } = advanceChain(s, state.chainKey)
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES)
  const ctBytes = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, messageKey)

  const combined = new Uint8Array(nonce.length + ctBytes.length)
  combined.set(nonce)
  combined.set(ctBytes, nonce.length)

  const payload: GroupWirePayload = {
    v: 1,
    type: 'group',
    chatId,
    iteration: state.iteration,
    sig: s.to_base64(s.crypto_sign_detached(combined, state.signingKeyPair.privateKey)),
    ct: s.to_base64(combined),
  }

  return {
    payload,
    nextState: {
      ...state,
      chainKey: nextChainKey,
      iteration: state.iteration + 1,
    },
  }
}

export async function senderKeyDecrypt(
  state: SenderKeyState,
  payload: GroupWirePayload,
): Promise<{ plaintext: string; nextState: SenderKeyState }> {
  const s = await getSodium()
  const combined = s.from_base64(payload.ct)
  const sig = s.from_base64(payload.sig)

  const valid = s.crypto_sign_verify_detached(sig, combined, state.signingKeyPair.publicKey)
  if (!valid) throw new Error('Invalid sender key signature')

  const { messageKey, nextState } = advanceToIteration(s, state, payload.iteration)
  const nonce = combined.slice(0, s.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(s.crypto_secretbox_NONCEBYTES)
  const plaintext = s.to_string(s.crypto_secretbox_open_easy(ct, nonce, messageKey))

  return { plaintext, nextState }
}

export function serializeSenderKeyState(state: SenderKeyState): string {
  return JSON.stringify({
    chainKey: Array.from(state.chainKey),
    iteration: state.iteration,
    signingKeyPair: {
      publicKey: Array.from(state.signingKeyPair.publicKey),
      privateKey: Array.from(state.signingKeyPair.privateKey),
    },
  })
}

export function deserializeSenderKeyState(data: string): SenderKeyState {
  const parsed = JSON.parse(data) as {
    chainKey: number[]
    iteration: number
    signingKeyPair: { publicKey: number[]; privateKey: number[] }
  }
  return {
    chainKey: new Uint8Array(parsed.chainKey),
    iteration: parsed.iteration,
    signingKeyPair: {
      publicKey: new Uint8Array(parsed.signingKeyPair.publicKey),
      privateKey: new Uint8Array(parsed.signingKeyPair.privateKey),
    },
  }
}

export function createSKDistribution(
  sodiumOrSenderId: unknown,
  chatIdOrSenderId: string,
  stateOrChatId: SenderKeyState | string,
  maybeState?: SenderKeyState,
): SKDistributionMessage {
  const usesLegacySignature = typeof sodiumOrSenderId !== 'string'
  const senderId = usesLegacySignature ? chatIdOrSenderId : sodiumOrSenderId
  const chatId = usesLegacySignature ? (stateOrChatId as string) : chatIdOrSenderId
  const state = usesLegacySignature
    ? maybeState!
    : (stateOrChatId as SenderKeyState)

  return {
    senderId,
    chatId,
    chainKey: sodium.to_base64(state.chainKey),
    iteration: state.iteration,
    signingPublicKey: sodium.to_base64(state.signingKeyPair.publicKey),
  }
}

export function importSKDistribution(
  sodiumOrSkdm: unknown,
  maybeSkdm?: SKDistributionMessage,
): SenderKeyState {
  const skdm = maybeSkdm ?? (sodiumOrSkdm as SKDistributionMessage)
  return {
    chainKey: sodium.from_base64(skdm.chainKey),
    iteration: skdm.iteration,
    signingKeyPair: {
      publicKey: sodium.from_base64(skdm.signingPublicKey),
      privateKey: new Uint8Array(64),
    },
  }
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

function advanceToIteration(
  s: SodiumWithHmac,
  state: SenderKeyState & { skippedKeys?: Record<number, string> },
  targetIteration: number,
): { messageKey: Uint8Array; nextState: SenderKeyState & { skippedKeys?: Record<number, string> } } {
  const skippedKeys: Record<number, string> = { ...state.skippedKeys }

  if (skippedKeys[targetIteration]) {
    const messageKey = s.from_base64(skippedKeys[targetIteration])
    const nextSkipped = { ...skippedKeys }
    delete nextSkipped[targetIteration]
    return { messageKey, nextState: { ...state, skippedKeys: nextSkipped } }
  }

  let chainKey = state.chainKey
  let iteration = state.iteration

  while (iteration < targetIteration) {
    const { messageKey, nextChainKey } = advanceChain(s, chainKey)
    skippedKeys[iteration] = s.to_base64(messageKey)
    chainKey = nextChainKey
    iteration += 1
    const keys = Object.keys(skippedKeys)
    if (keys.length > 100) delete skippedKeys[Number(keys[0])]
  }

  const { messageKey, nextChainKey } = advanceChain(s, chainKey)
  return {
    messageKey,
    nextState: {
      ...state,
      chainKey: nextChainKey,
      iteration: targetIteration + 1,
      skippedKeys,
    },
  }
}
