/**
 * IndexedDB-персистентность для истории сообщений и списка чатов.
 * Использует idb-keyval — тот же пакет что и keystore.ts.
 *
 * Стратегия хранения: ключ = `messages:<chatId>`, значение = Message[].
 * Обновление: полная перезапись массива (приемлемо для истории до ~200 сообщений).
 */

import { createStore } from 'idb-keyval'
import { encryptedSet, encryptedGet } from '../../../shared/native-core/storage/web/encryptedStore'
import type { Message, Chat } from '@/types'

const dataStore = createStore('messenger-data', 'data')

// ── Сообщения ────────────────────────────────────────────────

export async function saveMessages(chatId: string, msgs: Message[]): Promise<void> {
  await encryptedSet(`messages:${chatId}`, msgs, dataStore)
}

export async function loadMessages(chatId: string): Promise<Message[]> {
  return (await encryptedGet<Message[]>(`messages:${chatId}`, dataStore)) ?? []
}

/**
 * Добавить новые сообщения к существующим в IDB.
 * Дедупликация по id — не добавляем дубликаты.
 * Храним не более 200 последних сообщений на чат.
 */
export async function appendMessages(chatId: string, newMsgs: Message[]): Promise<void> {
  const existing = await loadMessages(chatId)
  const existingIds = new Set(existing.map((m) => m.id))
  const toAdd = newMsgs.filter((m) => !existingIds.has(m.id))
  if (toAdd.length === 0) return
  const merged = [...existing, ...toAdd].slice(-200)
  await saveMessages(chatId, merged)
}

/**
 * Обновить поле status конкретного сообщения в IDB.
 */
export async function updateMessageStatusInDb(
  chatId: string,
  msgId: string,
  status: Message['status']
): Promise<void> {
  const msgs = await loadMessages(chatId)
  const updated = msgs.map((m) =>
    m.id === msgId || m.clientMsgId === msgId ? { ...m, status } : m
  )
  await saveMessages(chatId, updated)
}

/**
 * Удалить одно сообщение из IDB по id или clientMsgId.
 */
export async function deleteMessageFromDb(chatId: string, msgId: string): Promise<void> {
  const msgs = await loadMessages(chatId)
  const filtered = msgs.filter((m) => m.id !== msgId && m.clientMsgId !== msgId)
  if (filtered.length !== msgs.length) {
    await saveMessages(chatId, filtered)
  }
}

// ── Чаты ─────────────────────────────────────────────────────

export async function saveChats(chats: Chat[]): Promise<void> {
  await encryptedSet('chats', chats, dataStore)
}

export async function loadChats(): Promise<Chat[]> {
  return (await encryptedGet<Chat[]>('chats', dataStore)) ?? []
}
