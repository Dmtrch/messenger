/**
 * Double Ratchet — шифрование сообщений после X3DH.
 *
 * Реализует симметричный рэтчет (chain key → message key) поверх
 * общего секрета из X3DH. DH-рэтчет подключается при смене ключей.
 *
 * Ссылка: https://signal.org/docs/specifications/doubleratchet/
 *
 * Упрощения текущей версии:
 *   - DH рэтчет выполняется каждые N сообщений (не per-message)
 *   - Skipped message keys не кэшируются (добавить в TODO)
 */

import _sodium from 'libsodium-wrappers'

// crypto_auth_hmacsha256 присутствует в рантайме libsodium, но отсутствует в @types/libsodium-wrappers
type SodiumWithHmac = typeof _sodium & {
  crypto_auth_hmacsha256(message: Uint8Array, key: Uint8Array): Uint8Array
}

let sodium: typeof _sodium

async function getSodium(): Promise<typeof _sodium> {
  if (!sodium) {
    await _sodium.ready
    sodium = _sodium
  }
  return sodium
}

export interface RatchetState {
  // DH Ratchet
  dhSendKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }
  dhRemotePublic: Uint8Array | null
  // Chain keys
  rootKey: Uint8Array
  sendChainKey: Uint8Array | null
  recvChainKey: Uint8Array | null
  // Счётчики
  sendCount: number
  recvCount: number
}

export interface EncryptedMessage {
  header: {
    dhPublic: string   // base64, текущий DH публичный ключ отправителя
    n: number          // порядковый номер в цепочке
  }
  ciphertext: string   // base64, XSalsa20-Poly1305
}

/** Инициализация состояния рэтчета из общего секрета X3DH */
export async function initRatchet(
  sharedSecret: Uint8Array,
  ourDHKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
  theirDHPublic: Uint8Array | null,
  isInitiator: boolean
): Promise<RatchetState> {
  const s = await getSodium()

  // Раскладываем sharedSecret в rootKey + первый chain key
  const derived = deriveKeys(s, sharedSecret, new Uint8Array(32))
  const rootKey = derived.rootKey
  const firstChainKey = derived.chainKey

  return {
    dhSendKeyPair: ourDHKeyPair,
    dhRemotePublic: theirDHPublic,
    rootKey,
    sendChainKey: isInitiator ? firstChainKey : null,
    recvChainKey: isInitiator ? null : firstChainKey,
    sendCount: 0,
    recvCount: 0,
  }
}

/** Зашифровать сообщение */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<{ message: EncryptedMessage; nextState: RatchetState }> {
  const s = await getSodium()

  if (!state.sendChainKey) throw new Error('No send chain key initialized')

  // Получить message key из текущего chain key
  const { messageKey, nextChainKey } = advanceChain(s, state.sendChainKey)

  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES)
  const ct = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, messageKey)

  // Объединяем nonce + ciphertext
  const combined = new Uint8Array(nonce.length + ct.length)
  combined.set(nonce)
  combined.set(ct, nonce.length)

  const message: EncryptedMessage = {
    header: {
      dhPublic: s.to_base64(state.dhSendKeyPair.publicKey),
      n: state.sendCount,
    },
    ciphertext: s.to_base64(combined),
  }

  const nextState: RatchetState = {
    ...state,
    sendChainKey: nextChainKey,
    sendCount: state.sendCount + 1,
  }

  return { message, nextState }
}

/** Расшифровать сообщение */
export async function ratchetDecrypt(
  state: RatchetState,
  message: EncryptedMessage
): Promise<{ plaintext: string; nextState: RatchetState }> {
  const s = await getSodium()

  let currentState = state
  const incomingDH = s.from_base64(message.header.dhPublic)

  // Если DH ключ сменился — выполнить DH рэтчет
  if (
    !currentState.dhRemotePublic ||
    !arraysEqual(incomingDH, currentState.dhRemotePublic)
  ) {
    currentState = await performDHRatchet(s, currentState, incomingDH)
  }

  if (!currentState.recvChainKey) throw new Error('No receive chain key')

  const { messageKey, nextChainKey } = advanceChain(s, currentState.recvChainKey)

  const combined = s.from_base64(message.ciphertext)
  const nonce = combined.slice(0, s.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(s.crypto_secretbox_NONCEBYTES)

  const plaintext = s.to_string(s.crypto_secretbox_open_easy(ct, nonce, messageKey))

  const nextState: RatchetState = {
    ...currentState,
    recvChainKey: nextChainKey,
    recvCount: currentState.recvCount + 1,
  }

  return { plaintext, nextState }
}

/** Сериализация состояния для хранения в IndexedDB */
export function serializeRatchetState(state: RatchetState): Uint8Array {
  const json = JSON.stringify({
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
  })
  return new TextEncoder().encode(json)
}

/** Десериализация состояния */
export function deserializeRatchetState(data: Uint8Array): RatchetState {
  const obj = JSON.parse(new TextDecoder().decode(data))
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
  }
}

// ── Внутренние функции ────────────────────────────────────

function advanceChain(
  s: typeof _sodium,
  chainKey: Uint8Array
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const sh = s as SodiumWithHmac
  // message key = HMAC(chainKey, 0x01)
  const messageKey = sh.crypto_auth_hmacsha256(new Uint8Array([0x01]), chainKey)
  // next chain key = HMAC(chainKey, 0x02)
  const nextChainKey = sh.crypto_auth_hmacsha256(new Uint8Array([0x02]), chainKey)
  return { messageKey, nextChainKey }
}

function deriveKeys(
  s: typeof _sodium,
  inputKey: Uint8Array,
  salt: Uint8Array
): { rootKey: Uint8Array; chainKey: Uint8Array } {
  // KDF: HKDF-like через BLAKE2b
  const okm = s.crypto_generichash(64, inputKey, salt)
  return {
    rootKey: okm.slice(0, 32),
    chainKey: okm.slice(32, 64),
  }
}

async function performDHRatchet(
  s: typeof _sodium,
  state: RatchetState,
  theirNewDHPublic: Uint8Array
): Promise<RatchetState> {
  // DH с новым ключом удалённой стороны
  const dhOutput = s.crypto_scalarmult(state.dhSendKeyPair.privateKey, theirNewDHPublic)

  // Обновляем root key и получаем новый recv chain key
  const derived = deriveKeys(s, dhOutput, state.rootKey)

  // Генерируем новый DH ключ для следующего рэтчета
  const newDHKeyPair = s.crypto_kx_keypair()

  return {
    ...state,
    dhSendKeyPair: newDHKeyPair,
    dhRemotePublic: theirNewDHPublic,
    rootKey: derived.rootKey,
    recvChainKey: derived.chainKey,
    sendChainKey: null, // будет инициализирован при следующей отправке
  }
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
