/**
 * Хук для автоматической повторной отправки сообщений из outbox при восстановлении WS.
 *
 * Срабатывает при смене wsSend с null на функцию (WS подключился).
 * Загружает очередь из outboxDb, отправляет каждый элемент и удаляет из очереди.
 */

import { useEffect, useRef } from 'react'
import { useWsStore } from '@/store/wsStore'
import { useChatStore } from '@/store/chatStore'
import { loadOutbox, removeFromOutbox } from '@/store/outboxDb'

export function useOfflineSync(): void {
  const wsSend = useWsStore((s) => s.send)
  const updateMessageStatus = useChatStore((s) => s.updateMessageStatus)
  const prevSendRef = useRef<typeof wsSend>(null)

  useEffect(() => {
    // Сброс outbox только при переходе null → функция (WS только что подключился)
    const wasNull = prevSendRef.current === null
    prevSendRef.current = wsSend

    if (!wsSend || !wasNull) return

    // WS только что восстановился — сбрасываем персистентную очередь
    loadOutbox().then((items) => {
      if (items.length === 0) return
      console.log(`[offline-sync] Отправка ${items.length} сообщений из outbox`)
      items.forEach((item) => {
        const sent = wsSend(item.frame)
        if (sent) {
          removeFromOutbox(item.id).catch(() => {})
          updateMessageStatus(item.chatId, item.id, 'sent')
        }
      })
    }).catch((e) => console.error('[offline-sync] Ошибка загрузки outbox', e))
  }, [wsSend, updateMessageStatus])
}
