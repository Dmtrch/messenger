/**
 * E2E Session Manager.
 *
 * Управляет жизненным циклом Double Ratchet сессий:
 * - Первое сообщение: X3DH → общий секрет → инициализация рэтчета
 * - Последующие: encrypt/decrypt через Double Ratchet
 * - Состояния хранятся в IndexedDB
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
import { api } from '@/api/client'
import {
  loadIdentityKey,
  loadSignedPreKey,
  consumeOneTimePreKey,
  loadRatchetSession,
  saveRatchetSession,
  type IdentityKeyPair,
} from './keystore'
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

function sessionKey(chatId: string, peerId: string) {
  return `${chatId}:${peerId}`
}

async function loadState(chatId: string, peerId: string): Promise<RatchetState | null> {
  const key = sessionKey(chatId, peerId)
  if (_stateCache.has(key)) return _stateCache.get(key)!
  const stored = await loadRatchetSession(key)
  if (!stored) return null
  const state = deserializeRatchetState(stored.state)
  _stateCache.set(key, state)
  return state
}

async function persistState(chatId: string, peerId: string, state: RatchetState) {
  const key = sessionKey(chatId, peerId)
  _stateCache.set(key, state)
  await saveRatchetSession({
    chatId: key,
    state: serializeRatchetState(state),
    updatedAt: Date.now(),
  })
}

// ── Инициализация сессии как инициатор (Alice) ────────────────────────────

async function initAsInitiator(
  peerId: string,
  myIdentity: IdentityKeyPair
): Promise<{ state: RatchetState; wire: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> }> {
  const bundle = await api.getKeyBundle(peerId)

  const ephemeral = generateDHKeyPair()
  const { sharedSecret, ephemeralKeyPublic, usedOpkId } = x3dhInitiatorAgreement(
    myIdentity,
    ephemeral,
    bundle
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

// ── Публичный API ─────────────────────────────────────────────────────────

/**
 * Зашифровать сообщение для получателя.
 * Возвращает base64-encoded wire payload.
 */
export async function encryptMessage(
  chatId: string,
  peerId: string,
  plaintext: string
): Promise<string> {
  await ensureSodium()

  const myIdentity = await loadIdentityKey()
  if (!myIdentity) throw new Error('Identity key not found')

  let state = await loadState(chatId, peerId)
  let wireExtra: Pick<WirePayload, 'ek' | 'opkId' | 'ikPub'> = {}

  if (!state) {
    const { state: newState, wire } = await initAsInitiator(peerId, myIdentity)
    state = newState
    wireExtra = wire
  }

  const { message, nextState } = await ratchetEncrypt(state, plaintext)
  await persistState(chatId, peerId, nextState)

  const payload: WirePayload = { v: 1, ...wireExtra, msg: message }
  return btoa(JSON.stringify(payload))
}

/**
 * Расшифровать входящее сообщение.
 * Принимает base64-encoded wire payload.
 * Возвращает plaintext.
 */
export async function decryptMessage(
  chatId: string,
  senderId: string,
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

  let state = await loadState(chatId, senderId)

  if (!state && payload.ek && payload.ikPub) {
    // Первое сообщение от этого отправителя — инициализируем как ответчик
    state = await initAsResponder(payload)
  }

  if (!state) throw new Error('No session and no X3DH header')

  const { plaintext, nextState } = await ratchetDecrypt(state, payload.msg)
  await persistState(chatId, senderId, nextState)

  return plaintext
}
