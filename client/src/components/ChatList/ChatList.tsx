import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import type { Chat } from '@/types'
import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'
import s from './ChatList.module.css'

interface Props {
  onSelect: (chatId: string) => void
}

export default function ChatList({ onSelect }: Props) {
  const chats = useChatStore((st) =>
    [...st.chats].sort((a, b) => b.updatedAt - a.updatedAt)
  )
  const presenceMap = useChatStore((st) => st.presenceMap)
  const currentUserId = useAuthStore((st) => st.currentUser?.id)

  if (chats.length === 0) {
    return <p className={s.empty}>Нет чатов. Начните новый разговор.</p>
  }

  return (
    <ul className={s.list} role="list">
      {chats.map((chat) => {
        const peerId = chat.type === 'direct'
          ? chat.members.find((id) => id !== currentUserId)
          : undefined
        const isOnline = peerId ? (presenceMap[peerId] ?? false) : false
        return (
          <ChatItem key={chat.id} chat={chat} isOnline={isOnline} onClick={() => onSelect(chat.id)} />
        )
      })}
    </ul>
  )
}

function ChatItem({ chat, isOnline, onClick }: { chat: Chat; isOnline: boolean; onClick: () => void }) {
  const time = chat.updatedAt
    ? formatDistanceToNowStrict(chat.updatedAt, { locale: ru })
    : ''

  return (
    <li>
      <button className={s.item} onClick={onClick} aria-label={`Чат ${chat.name}`}>
        <div className={s.avatarWrap}>
          <Avatar name={chat.name} avatarPath={chat.avatarPath} />
          {isOnline && <span className={s.onlineDot} aria-label="онлайн" />}
        </div>
        <div className={s.content}>
          <div className={s.row}>
            <span className={s.name}>{chat.name}</span>
            <span className={s.time}>{time}</span>
          </div>
          <div className={s.row}>
            <span className={s.preview}>{chat.lastMessage?.text ?? ''}</span>
            {chat.unreadCount > 0 && (
              <span className={s.badge}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

function Avatar({ name, avatarPath }: { name: string; avatarPath?: string }) {
  return (
    <div className={s.avatar} aria-hidden="true">
      {avatarPath
        ? <img src={avatarPath} alt="" />
        : <span>{name.charAt(0).toUpperCase()}</span>}
    </div>
  )
}
