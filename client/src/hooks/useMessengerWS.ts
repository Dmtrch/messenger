import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import { setAccessToken, api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useWsStore } from '@/store/wsStore'
import { decryptMessage } from '@/crypto/session'
import type { Chat, Message, WSFrame } from '@/types'

/** Разбирает расшифрованный payload — текст или медиа-JSON */
function parsePayload(raw: string): Pick<Message, 'text' | 'mediaId' | 'originalName' | 'type'> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (obj && typeof obj.mediaId === 'string') {
      return {
        type: (obj.mediaType as Message['type']) ?? 'file',
        mediaId: obj.mediaId,
        originalName: typeof obj.originalName === 'string' ? obj.originalName : undefined,
        text: typeof obj.text === 'string' ? obj.text : undefined,
      }
    }
  } catch { /* plain text */ }
  return { type: 'text', text: raw }
}

export function useMessengerWS() {
  const wsRef = useRef<MessengerWS | null>(null)
  const token = useAuthStore((s) => s.accessToken)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const logout = useAuthStore((s) => s.logout)
  const { addMessage, updateMessageStatus, setTyping, upsertChat, deleteMessage, editMessage } = useChatStore()
  const setSend = useWsStore((s) => s.setSend)

  useEffect(() => {
    if (!isAuthenticated || !token) return

    setAccessToken(token)

    const ws = new MessengerWS(
      token,
      (frame: WSFrame) => {
        switch (frame.type) {
          case 'message': {
            const { messageId, chatId, senderId, ciphertext, senderKeyId, timestamp, clientMsgId } = frame
            // Если чат неизвестен — подгружаем список чатов с сервера
            const knownChat = useChatStore.getState().chats.find((c) => c.id === chatId)
            if (!knownChat) {
              api.getChats().then((res) => {
                res.chats.forEach((c) => upsertChat(c as unknown as Chat))
              }).catch(() => {})
            }
            // Дедупликация: сообщение уже в сторе (оптимистичное добавление отправителем)
            const existingMsg = useChatStore.getState().messages[chatId]?.find(
              (m) => m.id === messageId || (clientMsgId && m.id === clientMsgId)
            )
            if (existingMsg) break

            // Расшифровываем асинхронно, потом обновляем стор
            decryptMessage(chatId, senderId, ciphertext)
              .then((raw) => {
                const parsed = parsePayload(raw)
                addMessage({
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', ...parsed,
                })
              })
              .catch(() => {
                addMessage({
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', type: 'text',
                  text: '[зашифровано]',
                })
              })
            break
          }

          case 'message_deleted': {
            deleteMessage(frame.chatId, frame.clientMsgId)
            break
          }

          case 'message_edited': {
            const { chatId, clientMsgId, ciphertext, editedAt } = frame
            const msgs = useChatStore.getState().messages[chatId] ?? []
            const target = msgs.find((m) => m.id === clientMsgId || m.clientMsgId === clientMsgId)
            if (!target) break
            // Расшифровываем обновлённый шифртекст
            decryptMessage(chatId, target.senderId, ciphertext)
              .then((text) => editMessage(chatId, clientMsgId, text))
              .catch(() => editMessage(chatId, clientMsgId, '[зашифровано]'))
            void editedAt // используется только на сервере
            break
          }

          case 'ack':
            // clientMsgId совпадает с id сообщения в нашем store
            updateMessageStatus(frame.chatId ?? '', frame.clientMsgId, 'sent')
            break

          case 'typing':
            setTyping(frame.chatId, frame.userId, true)
            setTimeout(() => setTyping(frame.chatId, frame.userId, false), 4000)
            break

          case 'presence':
            break

          case 'prekey_request':
            break

          case 'read':
            updateMessageStatus(frame.chatId, frame.messageId, 'read')
            break
        }
      },
      () => {
        // onConnect — регистрируем функцию отправки глобально
        setSend((frame) => ws.send(frame))
      },
      () => {
        setSend(null)
      },
      () => {
        setAccessToken(null)
        setSend(null)
        logout()
      }
    )

    ws.connect()
    wsRef.current = ws

    return () => {
      ws.disconnect()
      wsRef.current = null
      setSend(null)
    }
  }, [isAuthenticated, token, addMessage, updateMessageStatus, setTyping, logout, setSend])

  return wsRef
}
