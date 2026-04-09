import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatList from '@/components/ChatList/ChatList'
import NewChatModal from '@/components/NewChatModal/NewChatModal'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useChatStore } from '@/store/chatStore'
import { api } from '@/api/client'
import { loadChats } from '@/store/messageDb'
import type { Chat } from '@/types'
import s from './pages.module.css'

export default function ChatListPage() {
  const navigate = useNavigate()
  const { subscribe } = usePushNotifications()
  const [showNewChat, setShowNewChat] = useState(false)
  const setChats = useChatStore((s) => s.setChats)

  // Загрузить чаты: сначала из IDB (мгновенно), потом фоново с сервера
  useEffect(() => {
    // Шаг 1: кэш из IndexedDB — мгновенный отклик при offline/медленной сети
    loadChats().then((cached) => {
      if (cached.length > 0) setChats(cached)
    }).catch(() => {})

    // Шаг 2: актуальные данные с сервера (перезапишут кэш через setChats → saveChats)
    api.getChats().then((res) => {
      setChats(res.chats as unknown as Chat[])
    }).catch(() => {/* offline или токен истёк — используем кэш */})
  }, [setChats])

  // Запросить разрешение на push при первом открытии
  useEffect(() => { subscribe() }, [subscribe])

  function handleChatCreated(chatId: string) {
    setShowNewChat(false)
    navigate(`/chat/${chatId}`)
  }

  return (
    <div className={s.page}>
      <header className={s.topBar}>
        <h1 className={s.appTitle}>Messenger</h1>
        <div className={s.headerActions}>
          <button
            className={s.iconBtn}
            onClick={() => setShowNewChat(true)}
            aria-label="Новый чат"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className={s.iconBtn}
            onClick={() => navigate('/profile')}
            aria-label="Профиль"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </button>
        </div>
      </header>

      <ChatList onSelect={(id) => navigate(`/chat/${id}`)} />

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onChatCreated={handleChatCreated}
        />
      )}
    </div>
  )
}
