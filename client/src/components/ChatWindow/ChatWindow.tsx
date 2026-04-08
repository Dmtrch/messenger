import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useWsStore } from '@/store/wsStore'
import { api } from '@/api/client'
import { encryptMessage, decryptMessage } from '@/crypto/session'
import type { Message } from '@/types'
import s from './ChatWindow.module.css'

/** Разбирает расшифрованный payload — текст или медиа-JSON */
function parsePayload(raw: string): Pick<Message, 'text' | 'mediaId' | 'originalName' | 'type'> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (obj && typeof obj.mediaId === 'string') {
      return {
        type: (obj.mediaType as Message['type']) ?? 'file',
        mediaId: obj.mediaId,
        originalName: typeof obj.originalName === 'string' ? obj.originalName : undefined,
        text: typeof obj.text === 'string' ? obj.text : undefined,
      }
    }
  } catch { /* plain text */ }
  return { type: 'text', text: raw }
}

interface PendingMedia {
  mediaId: string
  originalName: string
  mediaType: 'image' | 'file'
  previewUrl?: string   // объектный URL для превью изображений
}

/** Генерация UUID с fallback для старых браузеров (iOS < 15.4, Chrome < 92) */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Декодирует base64 → текст (используется для истории сообщений) */
function tryDecode(payload: string): string {
  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return payload
  }
}

interface MenuState {
  msg: Message
  x: number
  y: number
}

interface Props {
  chatId: string
  onBack: () => void
}

export default function ChatWindow({ chatId, onBack }: Props) {
  const chat = useChatStore((st) => st.chats.find((c) => c.id === chatId))
  const messages = useChatStore((st) => st.messages[chatId] ?? [])
  const typingUsers = useChatStore((st) => st.typingUsers[chatId] ?? [])
  const addMessage = useChatStore((st) => st.addMessage)
  const prependMessages = useChatStore((st) => st.prependMessages)
  const deleteMessage = useChatStore((st) => st.deleteMessage)
  const editMessage = useChatStore((st) => st.editMessage)
  const markRead = useChatStore((st) => st.markRead)
  const currentUser = useAuthStore((st) => st.currentUser)
  const wsSend = useWsStore((st) => st.send)
  const [text, setText] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null)
  const [uploading, setUploading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const historyLoaded = useRef<Set<string>>(new Set())
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Очередь сообщений ожидающих подключения WS
  type PendingFrame = Parameters<NonNullable<typeof wsSend>>[0]
  const pendingQueue = useRef<PendingFrame[]>([])

  // Когда WS подключается — отправляем накопившиеся сообщения
  useEffect(() => {
    if (!wsSend || pendingQueue.current.length === 0) return
    const queue = pendingQueue.current.splice(0)
    queue.forEach((frame) => wsSend(frame))
  }, [wsSend])

  // Загружаем историю при первом открытии чата
  const loadHistory = useCallback(async (id: string) => {
    if (historyLoaded.current.has(id)) return
    historyLoaded.current.add(id)
    setLoadingHistory(true)
    try {
      const { messages: msgs } = await api.getMessages(id, { limit: 50 })
      if (msgs.length > 0) {
        const decoded = await Promise.all(msgs.map(async (m) => {
          let raw = tryDecode(m.encryptedPayload)
          try {
            raw = await decryptMessage(id, m.senderId, m.encryptedPayload)
          } catch { /* оставляем tryDecode результат */ }
          const parsed = parsePayload(raw)
          return {
            id: m.id,
            chatId: id,
            senderId: m.senderId,
            encryptedPayload: m.encryptedPayload,
            senderKeyId: m.senderKeyId,
            timestamp: m.timestamp,
            status: (m.read ? 'read' : m.delivered ? 'delivered' : 'sent') as Message['status'],
            ...parsed,
          }
        }))
        prependMessages(id, decoded)
      }
    } catch {
      // Игнорируем — сообщения уже в store или нет сети
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    markRead(chatId)
    loadHistory(chatId)
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [chatId, markRead, loadHistory])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Закрытие меню по Escape
  useEffect(() => {
    if (!menu) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [menu])

  // --- Контекстное меню ---

  const openMenu = useCallback((msg: Message, x: number, y: number) => {
    setMenu({ msg, x, y })
  }, [])

  const handleTouchStart = useCallback((msg: Message, e: React.TouchEvent) => {
    const { clientX, clientY } = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      openMenu(msg, clientX, clientY)
    }, 500)
  }, [openMenu])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }, [])

  const handleRightClick = useCallback((msg: Message, e: React.MouseEvent) => {
    e.preventDefault()
    openMenu(msg, e.clientX, e.clientY)
  }, [openMenu])

  const handleCopy = useCallback(() => {
    if (menu?.msg.text) {
      navigator.clipboard.writeText(menu.msg.text).catch(() => {})
    }
    setMenu(null)
  }, [menu])

  const handleEdit = useCallback(() => {
    if (!menu) return
    setEditingMsg(menu.msg)
    setText(menu.msg.text ?? '')
    setMenu(null)
  }, [menu])

  const handleDelete = useCallback(() => {
    if (!menu) return
    const msg = menu.msg
    const msgId = msg.clientMsgId ?? msg.id
    setMenu(null)
    // Оптимистично убираем из UI
    deleteMessage(msg.chatId, msgId)
    // Синхронизируем с сервером
    api.deleteMessage(msgId).catch(() => {
      // При ошибке — сообщение не было удалено на сервере, но мы его убрали локально.
      // При следующей загрузке истории оно появится снова.
    })
  }, [menu, deleteMessage])

  // --- Прикрепление файла ---

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''   // сбрасываем input чтобы можно было выбрать тот же файл снова
    if (!file) return

    const mediaType: PendingMedia['mediaType'] = file.type.startsWith('image/') ? 'image' : 'file'
    const previewUrl = mediaType === 'image' ? URL.createObjectURL(file) : undefined

    setUploading(true)
    try {
      const res = await api.uploadMedia(file, chatId)
      setPendingMedia({ mediaId: res.mediaId, originalName: file.name, mediaType, previewUrl })
    } catch {
      // Сообщаем через placeholder в поле ввода
      setText((t) => t || `[ошибка загрузки ${file.name}]`)
    } finally {
      setUploading(false)
    }
  }, [])

  const removePendingMedia = useCallback(() => {
    if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl)
    setPendingMedia(null)
  }, [pendingMedia])

  // --- Отправка ---

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!currentUser) return
    if (!trimmed && !pendingMedia) return

    // Режим редактирования — отправляем PATCH вместо нового сообщения
    if (editingMsg) {
      const clientMsgId = editingMsg.clientMsgId ?? editingMsg.id
      const members = chat?.members ?? [currentUser.id]
      const recipientPromises = members.map(async (userId) => {
        try {
          const ciphertext = await encryptMessage(chatId, userId, trimmed)
          return { userId, ciphertext }
        } catch {
          const bytes = new TextEncoder().encode(trimmed)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          return { userId, ciphertext: btoa(binary) }
        }
      })
      const recipients = await Promise.all(recipientPromises)
      // Оптимистично обновляем в UI
      editMessage(chatId, clientMsgId, trimmed)
      setText('')
      setEditingMsg(null)
      api.editMessage(clientMsgId, recipients).catch(() => {
        // Ошибка редактирования — UI уже обновлён локально
      })
      return
    }

    const msgId = generateId()

    // Формируем payload — текст или медиа-JSON
    let plainPayload: string
    let msgType: Message['type'] = 'text'
    if (pendingMedia) {
      msgType = pendingMedia.mediaType
      plainPayload = JSON.stringify({
        mediaId: pendingMedia.mediaId,
        originalName: pendingMedia.originalName,
        mediaType: pendingMedia.mediaType,
        text: trimmed || undefined,
      })
    } else {
      plainPayload = trimmed
    }

    const msg: Message = {
      id: msgId,
      chatId,
      senderId: currentUser.id,
      encryptedPayload: '',
      senderKeyId: 0,
      text: trimmed || pendingMedia?.originalName,
      mediaId: pendingMedia?.mediaId,
      originalName: pendingMedia?.originalName,
      timestamp: Date.now(),
      status: 'sending',
      type: msgType,
    }
    addMessage(msg)
    setText('')
    removePendingMedia()

    const members = chat?.members ?? [currentUser.id]
    const peers = members.filter((uid) => uid !== currentUser.id)

    // Шифруем payload для каждого получателя + копия для себя
    const recipientPromises = [...peers, currentUser.id].map(async (userId) => {
      try {
        const ciphertext = await encryptMessage(chatId, userId, plainPayload)
        return { userId, ciphertext }
      } catch {
        const bytes = new TextEncoder().encode(plainPayload)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        return { userId, ciphertext: btoa(binary) }
      }
    })

    const recipients = await Promise.all(recipientPromises)

    const frame: PendingFrame = {
      type: 'message',
      chatId,
      clientMsgId: msgId,
      senderKeyId: 0,
      recipients,
    }

    if (wsSend) {
      wsSend(frame)
    } else {
      pendingQueue.current.push(frame)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className={s.root}>
      <header className={s.header}>
        <button className={s.backBtn} onClick={onBack} aria-label="Назад">
          <BackIcon />
        </button>
        <div className={s.info}>
          <span className={s.chatName}>{chat?.name ?? 'Чат'}</span>
          {typingUsers.length > 0 && (
            <span className={s.typing}>печатает...</span>
          )}
        </div>
      </header>

      <div className={s.messages} role="log" aria-live="polite">
        {loadingHistory && <div className={s.loading}>Загрузка...</div>}
        {messages.map((msg) => (
          <Bubble
            key={msg.id}
            msg={msg}
            isOwn={msg.senderId === currentUser?.id}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onRightClick={handleRightClick}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {editingMsg && (
        <div className={s.editBanner}>
          <span>Редактирование: {editingMsg.text}</span>
          <button onClick={() => { setEditingMsg(null); setText('') }} aria-label="Отмена">✕</button>
        </div>
      )}

      {pendingMedia && (
        <div className={s.attachPreview}>
          {pendingMedia.mediaType === 'image' && pendingMedia.previewUrl
            ? <img src={pendingMedia.previewUrl} className={s.attachThumb} alt={pendingMedia.originalName} />
            : <FileIcon />
          }
          <span className={s.attachName}>{pendingMedia.originalName}</span>
          <button className={s.attachRemove} onClick={removePendingMedia} aria-label="Убрать">✕</button>
        </div>
      )}

      <div className={s.inputBar}>
        <input
          ref={fileInputRef}
          type="file"
          className={s.fileInput}
          accept="image/*,application/pdf,.zip,.txt,.mp4,.mp3"
          onChange={handleFileChange}
          aria-label="Прикрепить файл"
        />
        <button
          className={s.clipBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Прикрепить файл"
          title="Прикрепить файл"
        >
          {uploading ? <SpinnerIcon /> : <ClipIcon />}
        </button>
        <textarea
          className={s.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Сообщение"
          rows={1}
          maxLength={4096}
          aria-label="Ввод сообщения"
        />
        <button
          className={s.sendBtn}
          onClick={handleSend}
          disabled={!text.trim() && !pendingMedia}
          aria-label="Отправить"
        >
          <SendIcon />
        </button>
      </div>

      {/* Контекстное меню */}
      {menu && (
        <>
          <div className={s.menuBackdrop} onClick={() => setMenu(null)} />
          <ContextMenu
            msg={menu.msg}
            x={menu.x}
            y={menu.y}
            isOwn={menu.msg.senderId === currentUser?.id}
            onCopy={handleCopy}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  )
}

// --- Bubble ---

interface BubbleProps {
  msg: Message
  isOwn: boolean
  onTouchStart: (msg: Message, e: React.TouchEvent) => void
  onTouchEnd: () => void
  onRightClick: (msg: Message, e: React.MouseEvent) => void
}

function Bubble({ msg, isOwn, onTouchStart, onTouchEnd, onRightClick }: BubbleProps) {
  const time = new Date(msg.timestamp).toLocaleTimeString('ru', {
    hour: '2-digit', minute: '2-digit',
  })
  return (
    <div
      className={`${s.bubble} ${isOwn ? s.out : s.in}`}
      onTouchStart={(e) => onTouchStart(msg, e)}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
      onContextMenu={(e) => onRightClick(msg, e)}
    >
      {msg.type === 'image' && msg.mediaId && (
        <AuthImage mediaId={msg.mediaId} className={s.bubbleImage} alt={msg.originalName ?? 'изображение'} />
      )}
      {msg.type === 'file' && msg.mediaId && (
        <AuthFileLink mediaId={msg.mediaId} originalName={msg.originalName} className={s.bubbleFile}>
          <FileIcon />
          <span>{msg.originalName ?? msg.mediaId}</span>
        </AuthFileLink>
      )}
      {msg.text && <p className={s.bubbleText}>{msg.text}</p>}
      <div className={s.meta}>
        {msg.isEdited && <span className={s.edited}>изм.</span>}
        <span className={s.ts}>{time}</span>
        {isOwn && <StatusDots status={msg.status} />}
      </div>
    </div>
  )
}

// --- ContextMenu ---

interface ContextMenuProps {
  msg: Message
  x: number
  y: number
  isOwn: boolean
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}

function ContextMenu({ x, y, isOwn, onCopy, onEdit, onDelete }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Сдвигаем меню если выходит за границы экрана
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      className={s.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      <button className={s.menuItem} onClick={onCopy} role="menuitem">
        <CopyIcon /> Копировать
      </button>
      {isOwn && (
        <button className={s.menuItem} onClick={onEdit} role="menuitem">
          <EditIcon /> Редактировать
        </button>
      )}
      {isOwn && (
        <button className={`${s.menuItem} ${s.menuItemDanger}`} onClick={onDelete} role="menuitem">
          <DeleteIcon /> Удалить
        </button>
      )}
    </div>
  )
}

// --- Аутентифицированные медиа-компоненты ---

/** Загружает изображение через authenticated fetch и показывает через object URL. */
function AuthImage({ mediaId, className, alt }: { mediaId: string; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.fetchMediaBlobUrl(mediaId)
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [mediaId])

  if (!src) {
    return <div className={className} style={{ background: '#ddd', minHeight: 60, borderRadius: 4 }} />
  }
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} className={className} alt={alt} loading="lazy" />
    </a>
  )
}

/** Ссылка на файл через authenticated fetch + download. */
function AuthFileLink({
  mediaId, originalName, className, children,
}: {
  mediaId: string
  originalName?: string
  className?: string
  children: React.ReactNode
}) {
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      const url = await api.fetchMediaBlobUrl(mediaId)
      const a = document.createElement('a')
      a.href = url
      a.download = originalName ?? mediaId
      a.click()
    } catch { /* игнорируем */ }
  }, [mediaId, originalName])

  return (
    <a href="#" onClick={handleClick} className={className}>
      {children}
    </a>
  )
}

// --- Вспомогательные компоненты ---

function StatusDots({ status }: { status: Message['status'] }) {
  const map: Record<Message['status'], string> = {
    sending: '○', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '✗',
  }
  return (
    <span className={`${s.status} ${status === 'read' ? s.statusRead : ''}`}>
      {map[status]}
    </span>
  )
}

function ClipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S6 2.79 6 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
      style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="12" cy="12" r="10" strokeOpacity=".25"/>
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  )
}
