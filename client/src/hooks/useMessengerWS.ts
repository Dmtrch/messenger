import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import { setAccessToken, api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useWsStore } from '@/store/wsStore'
import { decryptMessage, decryptGroupMessage, handleIncomingSKDM } from '@/crypto/session'
import { appendOneTimePreKeys } from '@/crypto/keystore'
import { generateDHKeyPair, toBase64 } from '@/crypto/x3dh'
import type { Chat, Message, WSFrame } from '@/types'

/** Генерирует 20 новых OPK, сохраняет в keystore и загружает на сервер */
async function replenishPreKeys(): Promise<void> {
  const rawKeys = Array.from({ length: 20 }, () => generateDHKeyPair())
  const saved = await appendOneTimePreKeys(rawKeys)
  await api.uploadPreKeys(saved.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })))
}

/** Разбирает расшифрованный payload — текст или медиа-JSON */
function parsePayload(raw: string): Pick<Message, 'text' | 'mediaId' | 'mediaKey' | 'originalName' | 'type'> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (obj && typeof obj.mediaId === 'string') {
      return {
        type: (obj.mediaType as Message['type']) ?? 'file',
        mediaId: obj.mediaId,
        mediaKey: typeof obj.mediaKey === 'string' ? obj.mediaKey : undefined,
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
  const currentUser = useAuthStore((s) => s.currentUser)
  const logout = useAuthStore((s) => s.logout)
  const { addMessage, updateMessageStatus, setTyping, upsertChat, deleteMessage, editMessage, markRead } = useChatStore()
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

            // Определяем тип шифрования и расшифровываем
            const isGroupPayload = (() => {
              try { return JSON.parse(atob(ciphertext))?.type === 'group' } catch { return false }
            })()
            const decryptOp = isGroupPayload
              ? decryptGroupMessage(chatId, senderId, ciphertext)
              : decryptMessage(chatId, senderId, ciphertext)
            decryptOp
              .then((raw) => {
                const parsed = parsePayload(raw)
                addMessage({
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', ...parsed,
                }, currentUser?.id)
              })
              .catch(() => {
                addMessage({
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId: senderKeyId ?? 0,
                  timestamp, status: 'delivered', type: 'text',
                  text: '[зашифровано]',
                }, currentUser?.id)
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

          case 'skdm': {
            // Входящий Sender Key Distribution Message — сохраняем ключ отправителя
            const { chatId, senderId, ciphertext } = frame
            handleIncomingSKDM(chatId, senderId, ciphertext).catch((e) =>
              console.error('SKDM processing failed', e)
            )
            break
          }

          case 'prekey_request':
            break

          case 'prekey_low': {
            // Пополняем одноразовые ключи: генерируем 20 новых и загружаем на сервер
            replenishPreKeys().catch((e) =>
              console.error('prekey replenish failed', e)
            )
            break
          }

          case 'read': {
            // Обновляем статус конкретного сообщения
            updateMessageStatus(frame.chatId, frame.messageId, 'read')
            // Если читатель — текущий пользователь, сбрасываем счётчик непрочитанных
            if (frame.userId === currentUser?.id) {
              markRead(frame.chatId)
            }
            break
          }
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
  }, [isAuthenticated, token, currentUser, addMessage, updateMessageStatus, setTyping, logout, setSend, markRead])

  return wsRef
}
