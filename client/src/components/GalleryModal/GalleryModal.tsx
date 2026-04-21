import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { MediaGalleryItem } from '@/types'
import s from './GalleryModal.module.css'

// ── Вспомогательные утилиты ───────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi'])

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

type MediaType = 'image' | 'video' | 'file'

function classifyItem(item: MediaGalleryItem): MediaType {
  const ext = getExt(item.originalName)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return 'file'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

interface LightboxProps {
  items: MediaGalleryItem[]
  index: number
  blobUrls: Map<string, string>
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

function Lightbox({ items, index, blobUrls, onClose, onPrev, onNext }: LightboxProps) {
  const item = items[index]
  const src = item ? blobUrls.get(item.id) : undefined

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  const handleDownload = useCallback(async () => {
    if (!item) return
    try {
      const url = src ?? await api.fetchMediaBlobUrl(item.id)
      const a = document.createElement('a')
      a.href = url
      a.download = item.originalName
      a.click()
    } catch { /* игнорируем */ }
  }, [item, src])

  if (!item) return null

  return (
    <div className={s.lightboxOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={s.lightboxContent} onClick={(e) => e.stopPropagation()}>
        <button className={s.lightboxClose} onClick={onClose} aria-label="Закрыть">✕</button>
        <button className={s.lightboxDownload} onClick={handleDownload} aria-label="Скачать">⬇</button>

        {src
          ? <img src={src} className={s.lightboxImg} alt={item.originalName} />
          : <div className={s.lightboxLoading}>Загрузка...</div>
        }

        {items.length > 1 && (
          <>
            <button
              className={`${s.lightboxNav} ${s.lightboxNavPrev}`}
              onClick={onPrev}
              aria-label="Предыдущее"
              disabled={index === 0}
            >
              ‹
            </button>
            <button
              className={`${s.lightboxNav} ${s.lightboxNavNext}`}
              onClick={onNext}
              aria-label="Следующее"
              disabled={index === items.length - 1}
            >
              ›
            </button>
          </>
        )}

        <div className={s.lightboxCaption}>{item.originalName}</div>
      </div>
    </div>
  )
}

// ── GalleryModal ──────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'images' | 'files'

interface Props {
  chatId: string
  onClose: () => void
}

export default function GalleryModal({ chatId, onClose }: Props) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [items, setItems] = useState<MediaGalleryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map())
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  // Закрытие по ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Загрузка страницы медиа
  const loadPage = useCallback(async (pageNum: number) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await api.getChatMedia(chatId, pageNum)
      setItems((prev) => pageNum === 1 ? res.items : [...prev, ...res.items])
      setHasMore(res.hasMore)
      setPage(pageNum)

      // Загружаем blob URL для изображений
      for (const item of res.items) {
        const type = classifyItem(item)
        if (type === 'image' || type === 'video') {
          api.fetchMediaBlobUrl(item.id)
            .then((url) => {
              setBlobUrls((prev) => new Map(prev).set(item.id, url))
            })
            .catch(() => { /* превью недоступно */ })
        }
      }
    } catch { /* нет сети или ошибка */ } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [chatId])

  // Первичная загрузка
  useEffect(() => {
    void loadPage(1)
  }, [loadPage])

  // IntersectionObserver для бесконечного скролла
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          void loadPage(page + 1)
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, page, loadPage])

  // Освобождаем blob URLs при размонтировании
  useEffect(() => {
    return () => {
      blobUrls.forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Фильтрация
  const filtered = items.filter((item) => {
    const type = classifyItem(item)
    if (tab === 'images') return type === 'image' || type === 'video'
    if (tab === 'files') return type === 'file'
    return true
  })

  // Изображения для lightbox (только видимые)
  const imageItems = filtered.filter((item) => {
    const t = classifyItem(item)
    return t === 'image' || t === 'video'
  })

  const handleImageClick = useCallback((item: MediaGalleryItem) => {
    const idx = imageItems.findIndex((i) => i.id === item.id)
    if (idx >= 0) setLightboxIndex(idx)
  }, [imageItems])

  const handleFileDownload = useCallback(async (item: MediaGalleryItem) => {
    try {
      const url = await api.fetchMediaBlobUrl(item.id)
      const a = document.createElement('a')
      a.href = url
      a.download = item.originalName
      a.click()
    } catch { /* игнорируем */ }
  }, [])

  return (
    <div className={s.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Медиа-галерея">
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>Медиа-галерея</span>
          <button className={s.closeBtn} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className={s.tabs} role="tablist">
          {(['all', 'images', 'files'] as FilterTab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? 'Все' : t === 'images' ? 'Изображения' : 'Файлы'}
            </button>
          ))}
        </div>

        <div className={s.body}>
          {filtered.length === 0 && !loading && (
            <div className={s.empty}>Нет медиафайлов</div>
          )}

          {tab !== 'files' && (
            <div className={s.grid}>
              {filtered
                .filter((item) => classifyItem(item) !== 'file')
                .map((item) => {
                  const src = blobUrls.get(item.id)
                  return (
                    <button
                      key={item.id}
                      className={s.gridItem}
                      onClick={() => handleImageClick(item)}
                      aria-label={item.originalName}
                      title={item.originalName}
                    >
                      {src
                        ? <img src={src} className={s.gridImg} alt={item.originalName} loading="lazy" />
                        : <div className={s.gridPlaceholder} />
                      }
                    </button>
                  )
                })}
              {/* Файлы в режиме "Все" тоже показываем в списке ниже */}
            </div>
          )}

          {/* Список файлов */}
          {(tab === 'all' || tab === 'files') && (
            <div className={s.fileList}>
              {filtered
                .filter((item) => classifyItem(item) === 'file')
                .map((item) => (
                  <button
                    key={item.id}
                    className={s.fileItem}
                    onClick={() => void handleFileDownload(item)}
                    title={`Скачать ${item.originalName}`}
                  >
                    <span className={s.fileIcon}>📄</span>
                    <span className={s.fileName}>{item.originalName}</span>
                    <span className={s.fileSize}>{formatSize(item.size)}</span>
                  </button>
                ))}
            </div>
          )}

          {loading && <div className={s.loading}>Загрузка...</div>}
          <div ref={sentinelRef} />
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          items={imageItems}
          index={lightboxIndex}
          blobUrls={blobUrls}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i !== null && i < imageItems.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  )
}
