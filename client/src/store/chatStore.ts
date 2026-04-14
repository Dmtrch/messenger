import { create } from 'zustand'
import { saveChats } from '@/store/messageDb'
import { invalidateGroupSenderKey } from '@/crypto/session'
import type { Chat, Message } from '@/types'

interface ChatState {
  chats: Chat[]
  messages: Record<string, Message[]>
  typingUsers: Record<string, string[]>  // chatId → userId[]
  presenceMap: Record<string, boolean>   // userId → isOnline
  setChats: (chats: Chat[]) => void
  upsertChat: (chat: Chat) => void
  addMessage: (msg: Message, currentUserId?: string) => void
  prependMessages: (chatId: string, msgs: Message[]) => void
  updateMessageStatus: (chatId: string, msgId: string, status: Message['status']) => void
  deleteMessage: (chatId: string, msgId: string) => void
  editMessage: (chatId: string, clientMsgId: string, newText: string) => void
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void
  setPresence: (userId: string, online: boolean) => void
  markRead: (chatId: string) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  messages: {},
  typingUsers: {},
  presenceMap: {},

  setChats: (chats) => {
    set({ chats })
    // Персистировать список чатов в IndexedDB для offline-доступа
    saveChats(chats).catch(() => {})
  },

  upsertChat: (chat) =>
    set((s) => {
      const exists = s.chats.find((c) => c.id === chat.id)

      // При изменении состава группового чата инвалидируем SenderKey:
      // следующая отправка создаст новый ключ и разошлёт SKDM актуальным участникам.
      if (exists && chat.type === 'group') {
        const oldSorted = [...exists.members].sort().join(',')
        const newSorted = [...chat.members].sort().join(',')
        if (oldSorted !== newSorted) {
          invalidateGroupSenderKey(chat.id).catch(() => {})
        }
      }

      return {
        chats: exists
          ? s.chats.map((c) => (c.id === chat.id ? chat : c))
          : [...s.chats, chat],
      }
    }),

  addMessage: (msg, currentUserId) =>
    set((s) => {
      const existing = s.messages[msg.chatId] ?? []
      // Дедупликация по id — игнорируем если уже есть
      if (existing.some((m) => m.id === msg.id)) return s
      // Входящее сообщение от другого пользователя увеличивает счётчик непрочитанных
      const isIncoming = currentUserId != null && msg.senderId !== currentUserId
      return {
        messages: {
          ...s.messages,
          [msg.chatId]: [...existing, msg],
        },
        chats: s.chats.map((c) =>
          c.id === msg.chatId
            ? {
                ...c,
                lastMessage: msg,
                updatedAt: msg.timestamp,
                unreadCount: isIncoming ? (c.unreadCount ?? 0) + 1 : (c.unreadCount ?? 0),
              }
            : c
        ),
      }
    }),

  prependMessages: (chatId, msgs) =>
    set((s) => {
      const current = s.messages[chatId] ?? []
      const currentIds = new Set(current.map((m) => m.id))
      // Не добавляем сообщения которые уже есть в real-time
      const newMsgs = msgs.filter((m) => !currentIds.has(m.id))
      return {
        messages: {
          ...s.messages,
          [chatId]: [...newMsgs, ...current],
        },
      }
    }),

  updateMessageStatus: (chatId, msgId, status) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          m.id === msgId ? { ...m, status } : m
        ),
      },
    })),

  deleteMessage: (chatId, msgId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        // Удаляем по id или по clientMsgId (для совместимости)
        [chatId]: (s.messages[chatId] ?? []).filter(
          (m) => m.id !== msgId && m.clientMsgId !== msgId
        ),
      },
    })),

  editMessage: (chatId, clientMsgId, newText) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          m.id === clientMsgId || m.clientMsgId === clientMsgId
            ? { ...m, text: newText, isEdited: true }
            : m
        ),
      },
    })),

  setTyping: (chatId, userId, isTyping) =>
    set((s) => {
      const current = s.typingUsers[chatId] ?? []
      const next = isTyping
        ? current.includes(userId) ? current : [...current, userId]
        : current.filter((id) => id !== userId)
      return { typingUsers: { ...s.typingUsers, [chatId]: next } }
    }),

  setPresence: (userId, online) =>
    set((s) => ({ presenceMap: { ...s.presenceMap, [userId]: online } })),

  markRead: (chatId) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, unreadCount: 0 } : c
      ),
    })),

  // Сброс состояния при смене сервера
  reset: () => set({ chats: [], messages: {}, presenceMap: {} }),
}))
