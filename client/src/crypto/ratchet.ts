/**
 * Double Ratchet — шифрование сообщений после X3DH.
 *
 * Реализует Double Ratchet по спецификации Signal:
 * - Симметричный рэтчет (chain key → message key)
 * - DH рэтчет при смене ключей удалённой стороны (два шага, как в spec)
 * - Кэш пропущенных ключей для out-of-order доставки
 *
 * Ссылка: https://signal.org/docs/specifications/doubleratchet/
 */

import _sodium from 'libsodium-wrappers'

// crypto_auth_hmacsha256 присутствует в рантайме libsodium, но отсутствует в @types/libsodium-wrappers
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

/** Максимальное число кэшированных пропущенных ключей на сессию */
const MAX_SKIP = 100

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
  /** Кол-во сообщений в предыдущей send chain (pn в заголовке) */
  prevSendCount: number
  /** Кэш пропущенных ключей: "dhPubBase64:n" → messageKey base64 */
  skippedKeys: Record<string, string>
}

export interface EncryptedMessage {
  header: {
    dhPublic: string   // base64, текущий DH публичный ключ отправителя
    n: number          // порядковый номер в текущей цепочке
    pn: number         // кол-во сообщений в предыдущей цепочке
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

  return {
    dhSendKeyPair: ourDHKeyPair,
    dhRemotePublic: theirDHPublic,
    rootKey: derived.rootKey,
    sendChainKey: isInitiator ? derived.chainKey : null,
    recvChainKey: isInitiator ? null : derived.chainKey,
    sendCount: 0,
    recvCount: 0,
    prevSendCount: 0,
    skippedKeys: {},
  }
}

/** Зашифровать сообщение */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<{ message: EncryptedMessage; nextState: RatchetState }> {
  const s = await getSodium()

  if (!state.sendChainKey) throw new Error('No send chain key initialized')

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
      pn: state.prevSendCount,
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

/** Расшифровать сообщение (с поддержкой out-of-order) */
export async function ratchetDecrypt(
  state: RatchetState,
  message: EncryptedMessage
): Promise<{ plaintext: string; nextState: RatchetState }> {
  const s = await getSodium()

  const incomingDH = s.from_base64(message.header.dhPublic)
  const dhPubB64 = message.header.dhPublic
  const n = message.header.n
  const pn = message.header.pn ?? 0

  // 1. Проверить кэш пропущенных ключей
  const skipKey = `${dhPubB64}:${n}`
  if (state.skippedKeys[skipKey]) {
    const messageKey = s.from_base64(state.skippedKeys[skipKey])
    const nextSkipped = { ...state.skippedKeys }
    delete nextSkipped[skipKey]
    const plaintext = decryptWithKey(s, message, messageKey)
    return { plaintext, nextState: { ...state, skippedKeys: nextSkipped } }
  }

  let currentState = state

  // 2. DH рэтчет если ключ удалённой стороны сменился
  if (
    !currentState.dhRemotePublic ||
    !arraysEqual(incomingDH, currentState.dhRemotePublic)
  ) {
    // Кэшируем оставшиеся ключи предыдущей recv chain (до pn)
    currentState = skipMessageKeys(s, currentState, pn)
    currentState = await performDHRatchet(s, currentState, incomingDH)
  }

  // 3. Кэшируем пропущенные ключи в текущей recv chain (до n)
  currentState = skipMessageKeys(s, currentState, n)

  if (!currentState.recvChainKey) throw new Error('No receive chain key')

  // 4. Получить ключ сообщения n и расшифровать
  const { messageKey, nextChainKey } = advanceChain(s, currentState.recvChainKey)
  const plaintext = decryptWithKey(s, message, messageKey)

  const nextState: RatchetState = {
    ...currentState,
    recvChainKey: nextChainKey,
    recvCount: n + 1,
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
    prevSendCount: state.prevSendCount,
    skippedKeys: state.skippedKeys,
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
    prevSendCount: obj.prevSendCount ?? 0,
    skippedKeys: obj.skippedKeys ?? {},
  }
}

// ── Внутренние функции ────────────────────────────────────

function advanceChain(
  s: SodiumWithHmac,
  chainKey: Uint8Array
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  // message key = HMAC(chainKey, 0x01)
  const messageKey = s.crypto_auth_hmacsha256(new Uint8Array([0x01]), chainKey)
  // next chain key = HMAC(chainKey, 0x02)
  const nextChainKey = s.crypto_auth_hmacsha256(new Uint8Array([0x02]), chainKey)
  return { messageKey, nextChainKey }
}

function deriveKeys(
  s: SodiumWithHmac,
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

/**
 * Кэшировать ключи recv chain с recvCount до until (не включая until).
 * Возвращает обновлённое состояние с заполненным skippedKeys.
 */
function skipMessageKeys(
  s: SodiumWithHmac,
  state: RatchetState,
  until: number
): RatchetState {
  if (!state.recvChainKey || state.recvCount >= until) return state
  if (until - state.recvCount > MAX_SKIP) {
    throw new Error(`Too many skipped messages: ${until - state.recvCount}`)
  }

  const dhPubB64 = state.dhRemotePublic ? s.to_base64(state.dhRemotePublic) : 'none'
  const skippedKeys = { ...state.skippedKeys }
  let chainKey = state.recvChainKey
  let recvCount = state.recvCount

  while (recvCount < until) {
    const { messageKey, nextChainKey } = advanceChain(s, chainKey)
    skippedKeys[`${dhPubB64}:${recvCount}`] = s.to_base64(messageKey)
    chainKey = nextChainKey
    recvCount++

    // Ограничение: удаляем самый старый ключ при переполнении
    if (Object.keys(skippedKeys).length > MAX_SKIP) {
      delete skippedKeys[Object.keys(skippedKeys)[0]]
    }
  }

  return { ...state, skippedKeys, recvChainKey: chainKey, recvCount }
}

/**
 * Полный DH рэтчет по Signal spec (два шага):
 * Шаг 1: recv chain key из текущего send keypair + новый DH партнёра.
 * Шаг 2: новый send keypair + send chain key.
 * Это устраняет баг, при котором ответчик не мог отправить первое сообщение.
 */
async function performDHRatchet(
  s: SodiumWithHmac,
  state: RatchetState,
  theirNewDHPublic: Uint8Array
): Promise<RatchetState> {
  // Шаг 1: recv chain key
  const dhOutput1 = s.crypto_scalarmult(state.dhSendKeyPair.privateKey, theirNewDHPublic)
  const derived1 = deriveKeys(s, dhOutput1, state.rootKey)

  // Шаг 2: новый send key pair → send chain key
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

/** Расшифровать ciphertext конкретным ключом сообщения */
function decryptWithKey(
  s: SodiumWithHmac,
  message: EncryptedMessage,
  messageKey: Uint8Array
): string {
  const combined = s.from_base64(message.ciphertext)
  const nonce = combined.slice(0, s.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(s.crypto_secretbox_NONCEBYTES)
  return s.to_string(s.crypto_secretbox_open_easy(ct, nonce, messageKey))
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
