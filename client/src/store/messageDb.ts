/**
 * IndexedDB-персистентность для истории сообщений и списка чатов.
 * Использует idb-keyval — тот же пакет что и keystore.ts.
 *
 * Стратегия хранения: ключ = `messages:<chatId>`, значение = Message[].
 * Обновление: полная перезапись массива (приемлемо для истории до ~200 сообщений).
 */

import { get, set, createStore } from 'idb-keyval'
import type { Message, Chat } from '@/types'

const dataStore = createStore('messenger-data', 'data')

// ── Сообщения ────────────────────────────────────────────────

export async function saveMessages(chatId: string, msgs: Message[]): Promise<void> {
  await set(`messages:${chatId}`, msgs, dataStore)
}

export async function loadMessages(chatId: string): Promise<Message[]> {
  return (await get<Message[]>(`messages:${chatId}`, dataStore)) ?? []
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

// ── Чаты ─────────────────────────────────────────────────────

export async function saveChats(chats: Chat[]): Promise<void> {
  await set('chats', chats, dataStore)
}

export async function loadChats(): Promise<Chat[]> {
  return (await get<Chat[]>('chats', dataStore)) ?? []
}
