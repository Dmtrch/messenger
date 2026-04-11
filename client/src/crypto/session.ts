/**
 * E2E Session Manager.
 *
 * Управляет жизненным циклом Double Ratchet сессий:
 * - Первое сообщение: X3DH → общий секрет → инициализация рэтчета
 * - Последующие: encrypt/decrypt через Double Ratchet
 * - Состояния хранятся в IndexedDB
 *
 * sessionKey = peerId:deviceId (Signal Sesame spec)
 * Сессия — между парой устройств, не зависит от чата.
 *
 * Формат wire payload (base64-encoded JSON):
 * {
 *   v: 1,
 *   ek?: string,      // base64, эфемерный ключ Alice (только в первом сообщении)
 *   opkId?: number,   // ID использованного OPK (только в первом сообщении)
 *   ikPub?: string,   // base64, IK публичный ключ Alice (только в первом сообщении)
 *   msg: EncryptedMessage
 * }
 */

import _sodium from 'libsodium-wrappers'
import { api, type DeviceBundle } from '@/api/client'
import {
  loadIdentityKey,
  loadSignedPreKey,
  consumeOneTimePreKey,
  loadRatchetSession,
  saveRatchetSession,
  saveMySenderKey,
  loadMySenderKey,
  deleteMySenderKey,
  savePeerSenderKey,
  loadPeerSenderKey,
  type IdentityKeyPair,
} from './keystore'
import {
  generateSenderKey,
  senderKeyEncrypt,
  senderKeyDecrypt,
  serializeSenderKeyState,
  deserializeSenderKeyState,
  createSKDistribution,
  importSKDistribution,
  type GroupWirePayload,
  type SKDistributionMessage,
} from './senderkey'
import {
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
  generateDHKeyPair,
  initSodium,
  fromBase64,
  toBase64,
} from './x3dh'
import {
  initRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  deserializeRatchetState,
  type RatchetState,
  type EncryptedMessage,
} from './ratchet'
import type { PublicKeyBundle } from '@/types'

let sodiumReady = false
async function ensureSodium() {
  if (!sodiumReady) {
    await initSodium()
    await _sodium.ready
    sodiumReady = true
  }
}

interface WirePayload {
  v: 1
  ek?: string      // эфемерный ключ (X3DH initiator, первое сообщение)
  opkId?: number   // ID использованного OPK
  ikPub?: string   // публичный IK отправителя
  msg: EncryptedMessage
}

// ── Кэш состояний рэтчета в памяти (избегаем лишних обращений к IndexedDB) ─

const _stateCache = new Map<string, RatchetState>()

// Signal Sesame spec: сессия идентифицируется парой (userId, deviceId)
function sessionKey(peerUserId: string, peerDeviceId: string) {
  return `${peerUserId}:${peerDeviceId}`
}

async function loadState(peerId: string, deviceId: string): Promise<RatchetState | null> {
  const key = sessionKey(peerId, deviceId)
  if (_stateCache.has(key)) return _stateCache.get(key)!
  const stored = await loadRatchetSession(key)
  if (!stored) return null
  const state = deserializeRatchetState(stored.state)
  _stateCache.set(key, state)
  return state
}

async function persistState(peerId: string, deviceId: string, state: RatchetState) {
  const key = sessionKey(peerId, deviceId)
  _stateCache.set(key, state)
  await saveRatchetSession({
    chatId: key,
    state: serializeRatchetState(state),
    updatedAt: Date.now(),
  })
}

// ── Инициализация сессии как инициатор (Alice) ────────────────────────────

// Принимает DeviceBundle напрямую — caller отвечает за получение bundle с сервера
async function initAsInitiator(
  bundle: DeviceBundle,
  myIdentity: IdentityKeyPair
): Promise<{ state: RatchetState; wire: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> }> {
  const ephemeral = generateDHKeyPair()
  const { sharedSecret, ephemeralKeyPublic, usedOpkId } = x3dhInitiatorAgreement(
    myIdentity,
    ephemeral,
    bundle as unknown as PublicKeyBundle  // DeviceBundle структурно совместим
  )

  const state = await initRatchet(
    sharedSecret,
    ephemeral,
    fromBase64(bundle.spkPublic),
    true
  )

  return {
    state,
    wire: {
      ek: toBase64(ephemeralKeyPublic),
      opkId: usedOpkId,
      ikPub: toBase64(myIdentity.publicKey),
    },
  }
}

// ── Инициализация сессии как ответчик (Bob) ───────────────────────────────

async function initAsResponder(
  wire: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'>
): Promise<RatchetState> {
  const myIdentity = await loadIdentityKey()
  const mySpk = await loadSignedPreKey()
  if (!myIdentity || !mySpk) throw new Error('Ключи не найдены — переустановите приложение')

  const aliceIKPub = fromBase64(wire.ikPub!)
  const aliceEKPub = fromBase64(wire.ek!)

  const myOpk = wire.opkId !== undefined
    ? await consumeOneTimePreKey(wire.opkId)
    : undefined

  const sharedSecret = x3dhResponderAgreement(
    myIdentity,
    mySpk,
    myOpk,
    aliceIKPub,
    aliceEKPub
  )

  const state = await initRatchet(
    sharedSecret,
    mySpk,
    aliceEKPub,
    false
  )

  return state
}

// ── Шифрование для одного конкретного устройства (internal) ───────────────

async function encryptForDevice(
  recipientId: string,
  bundle: DeviceBundle,
  plaintext: string
): Promise<string> {
  const myIdentity = await loadIdentityKey()
  if (!myIdentity) throw new Error('Identity key not found')

  let state = await loadState(recipientId, bundle.deviceId)
  let wireExtra: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> = {}

  if (!state) {
    const { state: newState, wire } = await initAsInitiator(bundle, myIdentity)
    state = newState
    wireExtra = wire
  }

  const { message, nextState } = await ratchetEncrypt(state, plaintext)
  await persistState(recipientId, bundle.deviceId, nextState)

  const payload: WirePayload = { v: 1, ...wireExtra, msg: message }
  return btoa(JSON.stringify(payload))
}

// ── Публичный API ─────────────────────────────────────────────────────────

/**
 * Зашифровать сообщение для всех устройств получателя.
 * Возвращает массив {deviceId, ciphertext} — по одному на каждое устройство.
 */
export async function encryptForAllDevices(
  recipientId: string,
  bundles: DeviceBundle[],
  plaintext: string
): Promise<{ deviceId: string; ciphertext: string }[]> {
  await ensureSodium()
  return Promise.all(
    bundles.map(async (bundle) => ({
      deviceId: bundle.deviceId,
      ciphertext: await encryptForDevice(recipientId, bundle, plaintext),
    }))
  )
}

/**
 * Зашифровать сообщение для первого устройства получателя.
 * Используется для SKDM и других случаев, где нужен single-device encrypt.
 * Возвращает base64-encoded wire payload.
 */
export async function encryptMessage(
  recipientId: string,
  plaintext: string
): Promise<string> {
  await ensureSodium()
  const { devices } = await api.getKeyBundle(recipientId)
  if (!devices.length) throw new Error(`No devices found for ${recipientId}`)
  return encryptForDevice(recipientId, devices[0], plaintext)
}

// ── Публичный API для групповых чатов ─────────────────────────────────────

/**
 * Зашифровать групповое сообщение.
 * При первом вызове: генерирует SenderKey и распространяет SKDM всем участникам.
 * Возвращает JSON GroupWirePayload (base64-encoded) и список SKDM для отправки.
 */
export async function encryptGroupMessage(
  chatId: string,
  myUserId: string,
  members: string[],  // все участники включая себя
  plaintext: string
): Promise<{
  encodedPayload: string
  skdmRecipients: Array<{ userId: string; encodedSkdm: string }>
}> {
  await ensureSodium()

  let skdmRecipients: Array<{ userId: string; encodedSkdm: string }> = []

  // Загружаем или генерируем свой SenderKey
  let mySKSerialized = await loadMySenderKey(chatId)
  let mySK = mySKSerialized ? deserializeSenderKeyState(mySKSerialized) : null

  if (!mySK) {
    mySK = await generateSenderKey()
    await saveMySenderKey(chatId, serializeSenderKeyState(mySK))

    // Ленивое распространение SKDM всем участникам кроме себя
    const { default: _sodium } = await import('libsodium-wrappers')
    await _sodium.ready
    const skdm = createSKDistribution(_sodium, myUserId, chatId, mySK)
    const skdmJson = JSON.stringify(skdm)

    skdmRecipients = await Promise.all(
      members
        .filter((uid) => uid !== myUserId)
        .map(async (uid) => ({
          userId: uid,
          encodedSkdm: await encryptMessage(uid, skdmJson),
        }))
    )
  }

  const { payload, nextState } = await senderKeyEncrypt(mySK, chatId, plaintext)
  await saveMySenderKey(chatId, serializeSenderKeyState(nextState))

  return {
    encodedPayload: btoa(JSON.stringify(payload)),
    skdmRecipients,
  }
}

/**
 * Расшифровать групповое сообщение.
 * Принимает base64-encoded GroupWirePayload.
 */
export async function decryptGroupMessage(
  chatId: string,
  senderId: string,
  encodedPayload: string
): Promise<string> {
  await ensureSodium()

  const payload = JSON.parse(atob(encodedPayload)) as GroupWirePayload
  if (payload.type !== 'group') throw new Error('Not a group wire payload')

  const peerSKSerialized = await loadPeerSenderKey(chatId, senderId)
  if (!peerSKSerialized) throw new Error(`No sender key for ${senderId} in ${chatId}`)

  const peerSK = deserializeSenderKeyState(peerSKSerialized)
  const { plaintext, nextState } = await senderKeyDecrypt(peerSK, payload)
  await savePeerSenderKey(chatId, senderId, serializeSenderKeyState(nextState))

  return plaintext
}

/**
 * Обработать входящий SKDM от другого участника группы.
 * Сохраняет SenderKey отправителя в keystore.
 */
export async function handleIncomingSKDM(
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encodedSkdm: string  // base64-encoded encrypted individual message containing SKDM JSON
): Promise<void> {
  await ensureSodium()

  const { default: _sodium } = await import('libsodium-wrappers')
  await _sodium.ready

  // Расшифровываем SKDM через индивидуальную E2E сессию
  const skdmJson = await decryptMessage(senderId, senderDeviceId, encodedSkdm)
  const skdm = JSON.parse(skdmJson) as SKDistributionMessage

  const state = importSKDistribution(_sodium, skdm)
  await savePeerSenderKey(chatId, senderId, serializeSenderKeyState(state))
}

/**
 * Расшифровать входящее сообщение.
 * Принимает base64-encoded wire payload.
 * Возвращает plaintext.
 *
 * @param senderId - userId отправителя
 * @param senderDeviceId - deviceId отправителя (Signal Sesame: сессия per-device)
 * @param encodedPayload - base64-encoded wire payload
 */
export async function decryptMessage(
  senderId: string,
  senderDeviceId: string,
  encodedPayload: string
): Promise<string> {
  await ensureSodium()

  let payload: WirePayload
  try {
    payload = JSON.parse(atob(encodedPayload)) as WirePayload
  } catch {
    // Fallback для старых сообщений (plain base64 текст)
    try {
      const bytes = Uint8Array.from(atob(encodedPayload), (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    } catch {
      return encodedPayload
    }
  }

  if (!payload.msg) {
    // Старый формат — декодируем как base64 текст
    return atob(encodedPayload)
  }

  let state = await loadState(senderId, senderDeviceId)

  if (!state && payload.ek && payload.ikPub) {
    // Первое сообщение от этого устройства — инициализируем как ответчик
    state = await initAsResponder(payload)
  }

  if (!state) throw new Error('No session and no X3DH header')

  const { plaintext, nextState } = await ratchetDecrypt(state, payload.msg)
  await persistState(senderId, senderDeviceId, nextState)

  return plaintext
}

/**
 * Инвалидировать SenderKey группового чата при смене состава участников.
 * Удаляет ключ из IndexedDB и из памяти — следующая отправка создаст новый
 * SenderKey и разошлёт SKDM текущим участникам.
 */
export async function invalidateGroupSenderKey(chatId: string): Promise<void> {
  await deleteMySenderKey(chatId)
}

/**
 * Расшифровывает encryptedPayload последнего сообщения и возвращает текст превью для списка чатов.
 * При ошибке возвращает плейсхолдер, не бросает исключение.
 */
export async function tryDecryptPreview(
  chatType: 'direct' | 'group',
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encryptedPayload: string
): Promise<string> {
  try {
    const plaintext = chatType === 'group'
      ? await decryptGroupMessage(chatId, senderId, encryptedPayload)
      : await decryptMessage(senderId, senderDeviceId, encryptedPayload)
    try {
      const obj = JSON.parse(plaintext) as Record<string, unknown>
      if (obj && typeof obj.mediaId === 'string') return '📎 Вложение'
      if (typeof obj.text === 'string') return obj.text
    } catch { /* plain text */ }
    return plaintext
  } catch {
    return 'Зашифрованное сообщение'
  }
}
