import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import { setAccessToken, api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useWsStore } from '@/store/wsStore'
import { useCallStore } from '@/store/callStore'
import { decryptMessage, decryptGroupMessage, handleIncomingSKDM, tryDecryptPreview } from '@/crypto/session'
import { appendOneTimePreKeys, savePreKeyReplenishTime, isPreKeyReplenishOnCooldown } from '@/crypto/keystore'
import { generateDHKeyPair, toBase64 } from '@/crypto/x3dh'
import { appendMessages } from '@/store/messageDb'
import type { Chat, Message, WSFrame } from '@/types'

/** Минимальный интервал между пополнениями OPK (5 минут) */
const PREKEY_REPLENISH_COOLDOWN_MS = 5 * 60 * 1000

/** Генерирует 20 новых OPK, сохраняет в keystore и загружает на сервер.
 *  Имеет backoff: повторный вызов в течение PREKEY_REPLENISH_COOLDOWN_MS игнорируется. */
async function replenishPreKeys(): Promise<void> {
  if (await isPreKeyReplenishOnCooldown(PREKEY_REPLENISH_COOLDOWN_MS)) return
  const rawKeys = Array.from({ length: 20 }, () => generateDHKeyPair())
  const saved = await appendOneTimePreKeys(rawKeys)
  await api.uploadPreKeys(saved.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })))
  await savePreKeyReplenishTime()
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
            const { messageId, chatId, senderId, senderDeviceId, ciphertext, senderKeyId, timestamp, clientMsgId } = frame
            // Если чат неизвестен — подгружаем список чатов с сервера
            const knownChat = useChatStore.getState().chats.find((c) => c.id === chatId)
            if (!knownChat) {
              api.getChats().then(async (res) => {
                for (const c of res.chats) {
                  const raw = c as unknown as Chat
                  const lm = raw.lastMessage
                  const resolved = lm?.encryptedPayload && lm.senderId
                    ? { ...raw, lastMessage: { ...lm, text: await tryDecryptPreview(raw.type, raw.id, lm.senderId, '', lm.encryptedPayload) } }
                    : raw
                  upsertChat(resolved)
                }
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
              : decryptMessage(senderId, senderDeviceId ?? '', ciphertext)
            decryptOp
              .then((raw) => {
                const parsed = parsePayload(raw)
                const msg: Message = {
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', ...parsed,
                }
                addMessage(msg, currentUser?.id)
                // Персистировать расшифрованное сообщение в IndexedDB
                appendMessages(chatId, [msg]).catch(() => {})
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
            // Расшифровываем обновлённый шифртекст (senderDeviceId неизвестен для edited — передаём '')
            decryptMessage(target.senderId, '', ciphertext)
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
            // senderDeviceId для SKDM неизвестен из фрейма — передаём '' (первое устройство)
            handleIncomingSKDM(chatId, senderId, '', ciphertext).catch((e) =>
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

          case 'call_offer':
          case 'call_answer':
          case 'call_end':
          case 'call_reject':
          case 'call_busy':
          case 'ice_candidate': {
            // Делегируем в useCallHandler через callStore._callFrameHandler
            const handler = useCallStore.getState()._callFrameHandler
            if (handler) {
              handler(frame as Parameters<NonNullable<typeof handler>>[0])
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
