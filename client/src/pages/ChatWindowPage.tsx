import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChatWindow from '@/components/ChatWindow/ChatWindow'
import { useChatStore } from '@/store/chatStore'
import { api } from '@/api/client'
import { tryDecryptPreview } from '@/crypto/session'
import type { Chat } from '@/types'

interface Props {
  initiateCall?: (chatId: string, targetId: string, isVideo: boolean) => void
}

export default function ChatWindowPage({ initiateCall }: Props) {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const chat = useChatStore((s) => s.chats.find((c) => c.id === chatId))
  const upsertChat = useChatStore((s) => s.upsertChat)

  // Если чат не в store — загрузить с сервера
  useEffect(() => {
    if (!chatId || chat) return
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
  }, [chatId, chat, upsertChat])

  if (!chatId) return null

  return <ChatWindow chatId={chatId} onBack={() => navigate('/')} onCall={initiateCall} />
}
