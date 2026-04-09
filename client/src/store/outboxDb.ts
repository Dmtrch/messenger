/**
 * IndexedDB-очередь исходящих сообщений (outbox).
 *
 * Элементы добавляются при попытке отправки в offline-режиме.
 * При восстановлении WS-соединения очередь сбрасывается через useOfflineSync.
 *
 * Храним только type='message' фреймы — typing и read не нужны в персистентной очереди.
 */

import { get, set, createStore } from 'idb-keyval'
import type { Message } from '@/types'

const dataStore = createStore('messenger-data', 'data')

export interface OutboxItem {
  id: string                          // = clientMsgId сообщения
  chatId: string
  frame: {
    type: 'message'
    chatId: string
    clientMsgId: string
    senderKeyId: number
    recipients: Array<{ userId: string; ciphertext: string }>
  }
  optimisticMsg: Message              // для обновления UI при повторной отправке
  enqueuedAt: number
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const current = await loadOutbox()
  // Дедупликация: не дублируем если уже есть
  if (current.some((i) => i.id === item.id)) return
  await set('outbox', [...current, item], dataStore)
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>('outbox', dataStore)) ?? []
}

export async function removeFromOutbox(id: string): Promise<void> {
  const current = await loadOutbox()
  await set('outbox', current.filter((i) => i.id !== id), dataStore)
}

export async function clearOutbox(): Promise<void> {
  await set('outbox', [], dataStore)
}
