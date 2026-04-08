import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChatWindow from '@/components/ChatWindow/ChatWindow'
import { useChatStore } from '@/store/chatStore'
import { api } from '@/api/client'
import type { Chat } from '@/types'

export default function ChatWindowPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const chat = useChatStore((s) => s.chats.find((c) => c.id === chatId))
  const upsertChat = useChatStore((s) => s.upsertChat)

  // Если чат не в store — загрузить с сервера
  useEffect(() => {
    if (!chatId || chat) return
    api.getChats().then((res) => {
      res.chats.forEach((c) => upsertChat(c as unknown as Chat))
    }).catch(() => {})
  }, [chatId, chat, upsertChat])

  if (!chatId) return null

  return <ChatWindow chatId={chatId} onBack={() => navigate('/')} />
}
