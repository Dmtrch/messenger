// client/src/hooks/useBrowserWSBindings.ts

import { useMemo } from 'react'
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
  const deviceId        = useAuthStore((s) => s.deviceId)
  const logout          = useAuthStore((s) => s.logout)

  const setSend = useWsStore((s) => s.setSend)

  return useMemo(
    () => {
      // Zustand actions стабильны — читаем через getState() внутри useMemo,
      // чтобы захват происходил в момент пересчёта memo, а не на каждый render.
      const {
        addMessage,
        updateMessageStatus,
        setTyping,
        setPresence,
        upsertChat,
        deleteMessage,
        editMessage,
        markRead,
      } = useChatStore.getState()

      return {
        token,
        isAuthenticated,
        currentUserId: currentUser?.id,
        currentDeviceId: deviceId,
        logout,

        getCallFrameHandler: () => handleCallFrame ?? null,

        addMessage,
        appendMessages,
        updateMessageStatus,
        setTyping,
        setPresence,
        upsertChat,
        deleteMessage,
        editMessage,
        markRead,

        // Используем getState() — не подписка, всегда актуальное состояние
        getKnownChat: (chatId: string) =>
          useChatStore.getState().chats.find((c) => c.id === chatId) ?? null,
        getMessagesForChat: (chatId: string) =>
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, isAuthenticated, currentUser?.id, deviceId, logout, setSend, handleCallFrame],
  )
}
