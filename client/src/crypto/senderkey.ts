/**
 * Sender Key — симметричное шифрование для групповых чатов.
 *
 * Реализует упрощённый Sender Key Protocol по мотивам Signal:
 * - Каждый отправитель имеет один SenderKey на группу
 * - SKDM (SenderKeyDistributionMessage) распространяется лениво при первом сообщении
 * - Шифрование: симметричный рэтчет (HMAC-SHA256 chain) + XSalsa20-Poly1305
 * - Аутентификация ciphertext: Ed25519 подпись
 *
 * Ссылка: https://signal.org/docs/specifications/senderkey/
 */

import _sodium from 'libsodium-wrappers'

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

/** Состояние Sender Key для одного отправителя в одном чате */
export interface SenderKeyState {
  chainKey: Uint8Array             // 32 байта, продвигается с каждым сообщением
  iteration: number                // счётчик сообщений
  signingKeyPair: {                // Ed25519 — подпись ciphertext
    publicKey: Uint8Array
    privateKey: Uint8Array
  }
}

/** Сообщение с Sender Key Distribution для одного участника */
export interface SKDistributionMessage {
  senderId: string
  chatId: string
  chainKey: string           // base64
  iteration: number
  signingPublicKey: string   // base64
}

/** Wire payload для зашифрованного группового сообщения */
export interface GroupWirePayload {
  v: 1
  type: 'group'
  chatId: string
  iteration: number          // итерация цепочки отправителя
  sig: string                // base64, Ed25519 подпись ciphertext
  ct: string                 // base64, XSalsa20-Poly1305
}

/** Сгенерировать новый SenderKey для чата */
export async function generateSenderKey(): Promise<SenderKeyState> {
  const s = await getSodium()
  return {
    chainKey: s.randombytes_buf(32),
    iteration: 0,
    signingKeyPair: s.crypto_sign_keypair(),
  }
}

/** Зашифровать групповое сообщение своим SenderKey */
export async function senderKeyEncrypt(
  state: SenderKeyState,
  chatId: string,
  plaintext: string
): Promise<{ payload: GroupWirePayload; nextState: SenderKeyState }> {
  const s = await getSodium()

  const { messageKey, nextChainKey } = advanceChain(s, state.chainKey)

  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES)
  const ctBytes = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, messageKey)

  // combined = nonce || ciphertext
  const combined = new Uint8Array(nonce.length + ctBytes.length)
  combined.set(nonce)
  combined.set(ctBytes, nonce.length)

  const ct = s.to_base64(combined)
  const sig = s.to_base64(s.crypto_sign_detached(combined, state.signingKeyPair.privateKey))

  const payload: GroupWirePayload = {
    v: 1,
    type: 'group',
    chatId,
    iteration: state.iteration,
    sig,
    ct,
  }

  const nextState: SenderKeyState = {
    ...state,
    chainKey: nextChainKey,
    iteration: state.iteration + 1,
  }

  return { payload, nextState }
}

/** Расшифровать групповое сообщение ключом отправителя */
export async function senderKeyDecrypt(
  state: SenderKeyState,
  payload: GroupWirePayload
): Promise<{ plaintext: string; nextState: SenderKeyState }> {
  const s = await getSodium()

  const combined = s.from_base64(payload.ct)
  const sig = s.from_base64(payload.sig)

  // Проверяем Ed25519 подпись
  const valid = s.crypto_sign_verify_detached(sig, combined, state.signingKeyPair.publicKey)
  if (!valid) throw new Error('Invalid sender key signature')

  // Продвигаем chain до нужной итерации (с кэшем пропущенных)
  const { messageKey, nextState } = advanceToIteration(s, state, payload.iteration)

  const nonce = combined.slice(0, s.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(s.crypto_secretbox_NONCEBYTES)
  const plaintext = s.to_string(s.crypto_secretbox_open_easy(ct, nonce, messageKey))

  return { plaintext, nextState }
}

/** Сериализовать SenderKeyState для хранения в IndexedDB */
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

/** Десериализовать SenderKeyState */
export function deserializeSenderKeyState(data: string): SenderKeyState {
  const obj = JSON.parse(data) as {
    chainKey: number[]
    iteration: number
    signingKeyPair: { publicKey: number[]; privateKey: number[] }
  }
  return {
    chainKey: new Uint8Array(obj.chainKey),
    iteration: obj.iteration,
    signingKeyPair: {
      publicKey: new Uint8Array(obj.signingKeyPair.publicKey),
      privateKey: new Uint8Array(obj.signingKeyPair.privateKey),
    },
  }
}

/** Создать SKDM для передачи другому участнику */
export function createSKDistribution(
  s: typeof _sodium,
  senderId: string,
  chatId: string,
  state: SenderKeyState
): SKDistributionMessage {
  return {
    senderId,
    chatId,
    chainKey: s.to_base64(state.chainKey),
    iteration: state.iteration,
    signingPublicKey: s.to_base64(state.signingKeyPair.publicKey),
  }
}

/** Восстановить SenderKeyState из полученного SKDM (без приватного signing key) */
export function importSKDistribution(
  s: typeof _sodium,
  skdm: SKDistributionMessage
): SenderKeyState {
  // Для ключа получателя приватный signing key не нужен — только публичный
  return {
    chainKey: s.from_base64(skdm.chainKey),
    iteration: skdm.iteration,
    signingKeyPair: {
      publicKey: s.from_base64(skdm.signingPublicKey),
      privateKey: new Uint8Array(64), // заглушка — только для проверки подписи
    },
  }
}

// ── Внутренние функции ────────────────────────────────────

function advanceChain(
  s: SodiumWithHmac,
  chainKey: Uint8Array
): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const messageKey = s.crypto_auth_hmacsha256(new Uint8Array([0x01]), chainKey)
  const nextChainKey = s.crypto_auth_hmacsha256(new Uint8Array([0x02]), chainKey)
  return { messageKey, nextChainKey }
}

/** Продвинуть chain до нужной итерации.
 *  Пропущенные ключи кэшируются в skippedKeys (не больше 100). */
function advanceToIteration(
  s: SodiumWithHmac,
  state: SenderKeyState & { skippedKeys?: Record<number, string> },
  targetIteration: number
): { messageKey: Uint8Array; nextState: SenderKeyState & { skippedKeys?: Record<number, string> } } {
  const skippedKeys: Record<number, string> = { ...state.skippedKeys }

  // Проверить кэш пропущенных ключей
  if (skippedKeys[targetIteration]) {
    const messageKey = s.from_base64(skippedKeys[targetIteration])
    const nextSkipped = { ...skippedKeys }
    delete nextSkipped[targetIteration]
    return {
      messageKey,
      nextState: { ...state, skippedKeys: nextSkipped },
    }
  }

  let chainKey = state.chainKey
  let iteration = state.iteration

  // Кэшируем пропущенные итерации
  while (iteration < targetIteration) {
    const { messageKey, nextChainKey } = advanceChain(s, chainKey)
    skippedKeys[iteration] = s.to_base64(messageKey)
    chainKey = nextChainKey
    iteration++

    // Ограничение: удаляем самый старый при переполнении
    const keys = Object.keys(skippedKeys)
    if (keys.length > 100) {
      delete skippedKeys[Number(keys[0])]
    }
  }

  // Получаем ключ для целевой итерации
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
