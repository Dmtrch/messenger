import { create } from 'zustand'
import type { Chat, Message } from '@/types'

interface ChatState {
  chats: Chat[]
  messages: Record<string, Message[]>
  typingUsers: Record<string, string[]>  // chatId → userId[]
  setChats: (chats: Chat[]) => void
  upsertChat: (chat: Chat) => void
  addMessage: (msg: Message) => void
  prependMessages: (chatId: string, msgs: Message[]) => void
  updateMessageStatus: (chatId: string, msgId: string, status: Message['status']) => void
  deleteMessage: (chatId: string, msgId: string) => void
  editMessage: (chatId: string, clientMsgId: string, newText: string) => void
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void
  markRead: (chatId: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  messages: {},
  typingUsers: {},

  setChats: (chats) => set({ chats }),

  upsertChat: (chat) =>
    set((s) => {
      const exists = s.chats.find((c) => c.id === chat.id)
      return {
        chats: exists
          ? s.chats.map((c) => (c.id === chat.id ? chat : c))
          : [...s.chats, chat],
      }
    }),

  addMessage: (msg) =>
    set((s) => {
      const existing = s.messages[msg.chatId] ?? []
      // Дедупликация по id — игнорируем если уже есть
      if (existing.some((m) => m.id === msg.id)) return s
      return {
      messages: {
        ...s.messages,
        [msg.chatId]: [...existing, msg],
      },
      chats: s.chats.map((c) =>
        c.id === msg.chatId
          ? { ...c, lastMessage: msg, updatedAt: msg.timestamp }
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

  markRead: (chatId) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, unreadCount: 0 } : c
      ),
    })),
}))
