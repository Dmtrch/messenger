// client/src/hooks/useBrowserWSBindings.ts

import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useWsStore } from '@/store/wsStore'
import { appendMessages } from '@/store/messageDb'
import { decryptMessage, decryptGroupMessage, handleIncomingSKDM, tryDecryptPreview } from '@/crypto/session'
import { appendOneTimePreKeys, savePreKeyReplenishTime, isPreKeyReplenishOnCooldown } from '@/crypto/keystore'
import { generateDHKeyPair, toBase64 } from '@/crypto/x3dh'

import type { BrowserWSBindings, CallWSFrame } from '../../../shared/native-core'

/**
 * Собирает BrowserWSBindings из Zustand-сторов и crypto-зависимостей.
 * Изолирует все app-специфичные импорты в одном хуке.
 *
 * Статические функции (crypto, appendMessages) не вызывают лишних re-renders —
 * это стабильные ссылки.
 */
export function useBrowserWSBindings(
  handleCallFrame?: ((frame: CallWSFrame) => void) | null,
): BrowserWSBindings {
  const token           = useAuthStore((s) => s.accessToken)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const currentUser     = useAuthStore((s) => s.currentUser)
  const logout          = useAuthStore((s) => s.logout)

  const {
    addMessage,
    updateMessageStatus,
    setTyping,
    upsertChat,
    deleteMessage,
    editMessage,
    markRead,
  } = useChatStore()

  const setSend = useWsStore((s) => s.setSend)

  return {
    token,
    isAuthenticated,
    currentUserId: currentUser?.id,
    logout,

    getCallFrameHandler: () => handleCallFrame ?? null,

    addMessage,
    appendMessages,
    updateMessageStatus,
    setTyping,
    upsertChat,
    deleteMessage,
    editMessage,
    markRead,

    // Используем getState() — не подписка, всегда актуальное состояние
    getKnownChat: (chatId) =>
      useChatStore.getState().chats.find((c) => c.id === chatId) ?? null,
    getMessagesForChat: (chatId) =>
      useChatStore.getState().messages[chatId] ?? [],

    setSend,

    // Crypto — стабильные ссылки, не зависят от render-цикла
    decryptMessage,
    decryptGroupMessage,
    handleIncomingSKDM,
    tryDecryptPreview,
    appendOneTimePreKeys,
    savePreKeyReplenishTime,
    isPreKeyReplenishOnCooldown,
    generateDHKeyPair,
    toBase64,
  }
}
