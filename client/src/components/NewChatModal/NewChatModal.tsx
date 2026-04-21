import { useState, useEffect, useRef } from 'react'
import { api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
import type { Chat } from '@/types'
import s from './NewChatModal.module.css'

interface Props {
  onClose: () => void
  onChatCreated: (chatId: string) => void
  allowGroupChat?: boolean
}

interface UserResult {
  id: string
  username: string
  displayName: string
}

export default function NewChatModal({ onClose, onChatCreated, allowGroupChat = true }: Props) {
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const upsertChat = useChatStore((s) => s.upsertChat)

  useEffect(() => { inputRef.current?.focus() }, [mode])

  // Поиск с дебаунсом
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.searchUsers(query.trim())
        // В режиме группы исключаем уже выбранных
        setResults(
          mode === 'group'
            ? res.users.filter((u) => !selected.find((s) => s.id === u.id))
            : res.users
        )
      } catch {
        setError('Ошибка поиска')
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, mode, selected])

  async function startDirectChat(user: UserResult) {
    setCreating(true)
    setError('')
    try {
      const res = await api.createChat({ type: 'direct', memberIds: [user.id] })
      const chat = res.chat as unknown as Chat
      upsertChat({
        ...chat,
        name: chat.name || user.displayName || user.username,
        unreadCount: chat.unreadCount ?? 0,
        updatedAt: chat.updatedAt ?? Date.now(),
      })
      onChatCreated(res.chat.id)
    } catch {
      setError('Не удалось создать чат')
    } finally {
      setCreating(false)
    }
  }

  async function createGroupChat() {
    if (selected.length < 2) { setError('Выберите минимум 2 участника'); return }
    if (!groupName.trim()) { setError('Введите название группы'); return }
    setCreating(true)
    setError('')
    try {
      const res = await api.createChat({
        type: 'group',
        memberIds: selected.map((u) => u.id),
        name: groupName.trim(),
      })
      const chat = res.chat as unknown as Chat
      upsertChat({
        ...chat,
        unreadCount: chat.unreadCount ?? 0,
        updatedAt: chat.updatedAt ?? Date.now(),
      })
      onChatCreated(res.chat.id)
    } catch {
      setError('Не удалось создать группу')
    } finally {
      setCreating(false)
    }
  }

  function toggleSelect(user: UserResult) {
    setSelected((prev) =>
      prev.find((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    )
    setQuery('')
  }

  function onOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={s.overlay} onClick={onOverlayClick} role="dialog" aria-modal="true">
      <div className={s.modal}>
        <div className={s.header}>
          <h2 className={s.title}>Новый чат</h2>
          <button className={s.closeBtn} onClick={onClose} aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
        </div>

        {/* Переключатель режима */}
        <div className={s.tabs}>
          <button
            className={`${s.tab} ${mode === 'direct' ? s.tabActive : ''}`}
            onClick={() => { setMode('direct'); setSelected([]); setQuery(''); setError('') }}
          >
            Личный
          </button>
          {allowGroupChat && (
            <button
              className={`${s.tab} ${mode === 'group' ? s.tabActive : ''}`}
              onClick={() => { setMode('group'); setQuery(''); setError('') }}
            >
              Группа
            </button>
          )}
        </div>

        {/* Поле имени группы */}
        {mode === 'group' && (
          <input
            className={s.input}
            type="text"
            placeholder="Название группы"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            style={{ marginBottom: '0.5rem' }}
          />
        )}

        {/* Выбранные участники (только в группе) */}
        {mode === 'group' && selected.length > 0 && (
          <div className={s.chips}>
            {selected.map((u) => (
              <span key={u.id} className={s.chip}>
                {u.displayName || u.username}
                <button onClick={() => toggleSelect(u)} aria-label="Удалить">×</button>
              </span>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          className={s.input}
          type="search"
          placeholder="Поиск по имени или username..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && <p className={s.error}>{error}</p>}

        <ul className={s.list}>
          {loading && <li className={s.hint}>Поиск...</li>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <li className={s.hint}>Пользователи не найдены</li>
          )}
          {!loading && query.trim().length < 2 && mode === 'direct' && (
            <li className={s.hint}>Введите минимум 2 символа</li>
          )}
          {!loading && query.trim().length < 2 && mode === 'group' && (
            <li className={s.hint}>
              {selected.length === 0 ? 'Добавьте участников' : `${selected.length} участник(ов) выбрано`}
            </li>
          )}
          {results.map((user) => (
            <li key={user.id}>
              <button
                className={s.userItem}
                onClick={() => mode === 'direct' ? startDirectChat(user) : toggleSelect(user)}
                disabled={creating}
              >
                <div className={s.avatar}>
                  {(user.displayName || user.username).charAt(0).toUpperCase()}
                </div>
                <div className={s.info}>
                  <span className={s.name}>{user.displayName || user.username}</span>
                  <span className={s.username}>@{user.username}</span>
                </div>
                {mode === 'group' && (
                  <span className={s.addIcon}>+</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Кнопка создания группы */}
        {mode === 'group' && (
          <button
            className={s.createBtn}
            onClick={createGroupChat}
            disabled={creating || selected.length < 2}
          >
            {creating ? 'Создание...' : `Создать группу (${selected.length})`}
          </button>
        )}
      </div>
    </div>
  )
}
