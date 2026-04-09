# Stage 6: Offline/PWA Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить полноценный offline-слой: IndexedDB-персистентность истории сообщений и чатов, очередь исходящих сообщений с автоматической повторной отправкой, и UI-индикацию offline-состояния.

**Architecture:** Отдельный модуль `messageDb.ts` управляет IndexedDB-хранилищем через `idb-keyval` (уже в зависимостях). При старте приложения данные загружаются из кэша мгновенно, фоновая синхронизация с сервером происходит параллельно. Исходящие сообщения при отрыве сети попадают в `outboxDb.ts` и автоматически отправляются при восстановлении WS-соединения.

**Tech Stack:** idb-keyval (уже установлен), Zustand, VitePWA/Workbox, React hooks, CSS Modules.

---

## Карта файлов

### Создать:
- `client/src/store/messageDb.ts` — IndexedDB-репозиторий для истории сообщений и списка чатов
- `client/src/store/outboxDb.ts` — IndexedDB-очередь исходящих (outbox) с функциями enqueue/dequeue
- `client/src/hooks/useNetworkStatus.ts` — хук `{ isOnline: boolean }` через window events
- `client/src/hooks/useOfflineSync.ts` — хук сброса outbox при восстановлении WS
- `client/src/components/OfflineIndicator/OfflineIndicator.tsx` — UI-баннер offline
- `client/src/components/OfflineIndicator/OfflineIndicator.module.css` — стили баннера

### Изменить:
- `client/src/hooks/useMessengerWS.ts` — сохранять входящие сообщения в messageDb
- `client/src/components/ChatWindow/ChatWindow.tsx` — загрузка из IDB при открытии, запись в IDB при приёме/отправке, outbox при offline
- `client/src/pages/ChatListPage.tsx` — загружать чаты из IDB сразу, background sync с сервером
- `client/src/App.tsx` — подключить `useOfflineSync`, добавить `<OfflineIndicator />`
- `client/vite.config.ts` — добавить `networkTimeoutSeconds` в workbox NetworkFirst

---

## Task 1: messageDb.ts — IndexedDB для истории и чатов

**Files:**
- Create: `client/src/store/messageDb.ts`

- [ ] **Step 1.1: Создать messageDb.ts**

```typescript
/**
 * IndexedDB-персистентность для истории сообщений и списка чатов.
 * Использует idb-keyval — тот же пакет что и keystore.ts.
 *
 * Стратегия хранения: ключ = `messages:<chatId>`, значение = Message[].
 * Обновление: полная перезапись массива (приемлемо для истории до ~500 сообщений).
 */

import { get, set, createStore } from 'idb-keyval'
import type { Message, Chat } from '@/types'

const dataStore = createStore('messenger-data', 'data')

// ── Сообщения ────────────────────────────────────────────────

export async function saveMessages(chatId: string, msgs: Message[]): Promise<void> {
  await set(`messages:${chatId}`, msgs, dataStore)
}

export async function loadMessages(chatId: string): Promise<Message[]> {
  return (await get<Message[]>(`messages:${chatId}`, dataStore)) ?? []
}

/**
 * Добавить новые сообщения к существующим в IDB.
 * Дедупликация по id — не добавляем дубликаты.
 */
export async function appendMessages(chatId: string, newMsgs: Message[]): Promise<void> {
  const existing = await loadMessages(chatId)
  const existingIds = new Set(existing.map((m) => m.id))
  const toAdd = newMsgs.filter((m) => !existingIds.has(m.id))
  if (toAdd.length === 0) return
  // Храним не более 200 последних сообщений на чат
  const merged = [...existing, ...toAdd].slice(-200)
  await saveMessages(chatId, merged)
}

/**
 * Обновить поле status конкретного сообщения в IDB.
 */
export async function updateMessageStatusInDb(
  chatId: string,
  msgId: string,
  status: Message['status']
): Promise<void> {
  const msgs = await loadMessages(chatId)
  const updated = msgs.map((m) =>
    m.id === msgId || m.clientMsgId === msgId ? { ...m, status } : m
  )
  await saveMessages(chatId, updated)
}

// ── Чаты ─────────────────────────────────────────────────────

export async function saveChats(chats: Chat[]): Promise<void> {
  await set('chats', chats, dataStore)
}

export async function loadChats(): Promise<Chat[]> {
  return (await get<Chat[]>('chats', dataStore)) ?? []
}
```

- [ ] **Step 1.2: Проверить type-check**

```bash
cd client && npm run type-check
```

Ожидание: 0 ошибок (пустой модуль, только импорты из существующих пакетов).

- [ ] **Step 1.3: Коммит**

```bash
cd client && git add src/store/messageDb.ts
git commit -m "feat(offline): добавить messageDb — IndexedDB для истории сообщений"
```

---

## Task 2: outboxDb.ts — персистентная очередь исходящих

**Files:**
- Create: `client/src/store/outboxDb.ts`

- [ ] **Step 2.1: Создать outboxDb.ts**

```typescript
/**
 * IndexedDB-очередь исходящих сообщений (outbox).
 *
 * Элементы добавляются при попытке отправки в offline-режиме.
 * При восстановлении WS-соединения очередь сбрасывается через useOfflineSync.
 *
 * Храним только type='message' фреймы — typing и read не нужны в персистентной очереди.
 */

import { get, set, createStore } from 'idb-keyval'
import type { Message } from '@/types'

const dataStore = createStore('messenger-data', 'data')

export interface OutboxItem {
  id: string                          // = clientMsgId сообщения
  chatId: string
  frame: {
    type: 'message'
    chatId: string
    clientMsgId: string
    senderKeyId: number
    recipients: Array<{ userId: string; ciphertext: string }>
  }
  optimisticMsg: Message              // для обновления UI при повторной отправке
  enqueuedAt: number
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const current = await loadOutbox()
  // Дедупликация: не дублируем если уже есть
  if (current.some((i) => i.id === item.id)) return
  await set('outbox', [...current, item], dataStore)
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>('outbox', dataStore)) ?? []
}

export async function removeFromOutbox(id: string): Promise<void> {
  const current = await loadOutbox()
  await set('outbox', current.filter((i) => i.id !== id), dataStore)
}

export async function clearOutbox(): Promise<void> {
  await set('outbox', [], dataStore)
}
```

- [ ] **Step 2.2: Проверить type-check**

```bash
cd client && npm run type-check
```

- [ ] **Step 2.3: Коммит**

```bash
git add src/store/outboxDb.ts
git commit -m "feat(offline): добавить outboxDb — персистентная очередь исходящих"
```

---

## Task 3: useNetworkStatus — хук отслеживания сети

**Files:**
- Create: `client/src/hooks/useNetworkStatus.ts`

- [ ] **Step 3.1: Создать хук**

```typescript
/**
 * Хук для отслеживания состояния сетевого подключения.
 * Слушает window.online/offline события + проверяет navigator.onLine при монтировании.
 */

import { useEffect, useState } from 'react'

export function useNetworkStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline }
}
```

- [ ] **Step 3.2: Коммит**

```bash
git add src/hooks/useNetworkStatus.ts
git commit -m "feat(offline): добавить useNetworkStatus хук"
```

---

## Task 4: OfflineIndicator — UI-баннер offline-состояния

**Files:**
- Create: `client/src/components/OfflineIndicator/OfflineIndicator.tsx`
- Create: `client/src/components/OfflineIndicator/OfflineIndicator.module.css`

- [ ] **Step 4.1: Создать CSS-модуль**

```css
/* OfflineIndicator.module.css */
.banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: #b91c1c;
  color: #fff;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
```

- [ ] **Step 4.2: Создать компонент**

```tsx
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import s from './OfflineIndicator.module.css'

export default function OfflineIndicator() {
  const { isOnline } = useNetworkStatus()
  if (isOnline) return null

  return (
    <div className={s.banner} role="alert" aria-live="assertive">
      <svg className={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
      </svg>
      Нет подключения — показаны кэшированные данные
    </div>
  )
}
```

- [ ] **Step 4.3: Проверить type-check**

```bash
cd client && npm run type-check
```

- [ ] **Step 4.4: Коммит**

```bash
git add src/components/OfflineIndicator/
git commit -m "feat(offline): добавить OfflineIndicator компонент"
```

---

## Task 5: Сохранять входящие сообщения в IDB через useMessengerWS

**Files:**
- Modify: `client/src/hooks/useMessengerWS.ts`

- [ ] **Step 5.1: Прочитать текущий useMessengerWS.ts**

Файл расположен в `client/src/hooks/useMessengerWS.ts`. Ключевое место — блок `case 'message':` (строки 54–93), где вызывается `addMessage(...)`. После `addMessage` нужно добавить вызов `appendMessages`.

- [ ] **Step 5.2: Добавить импорт и вызов appendMessages**

В начало файла добавить импорт:
```typescript
import { appendMessages } from '@/store/messageDb'
```

В блоке `case 'message':`, сразу после вызова `addMessage(...)` в `.then()` добавить сохранение в IDB:

Найти (строки ~78–83):
```typescript
              .then((raw) => {
                const parsed = parsePayload(raw)
                addMessage({
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', ...parsed,
                }, currentUser?.id)
              })
```

Заменить на:
```typescript
              .then((raw) => {
                const parsed = parsePayload(raw)
                const msg: Message = {
                  id: messageId, clientMsgId, chatId, senderId,
                  encryptedPayload: ciphertext, senderKeyId,
                  timestamp, status: 'delivered', ...parsed,
                }
                addMessage(msg, currentUser?.id)
                // Персистировать расшифрованное сообщение в IndexedDB
                appendMessages(chatId, [msg]).catch(() => {})
              })
```

Также обновить импорт типа `Message` — он уже импортируется. Нужно только убедиться что `Message` есть в импорте `from '@/types'`.

- [ ] **Step 5.3: Проверить type-check и lint**

```bash
cd client && npm run type-check && npm run lint
```

- [ ] **Step 5.4: Коммит**

```bash
git add src/hooks/useMessengerWS.ts
git commit -m "feat(offline): сохранять входящие сообщения в IndexedDB"
```

---

## Task 6: Загружать историю из IDB в ChatWindow + fallback при offline

**Files:**
- Modify: `client/src/components/ChatWindow/ChatWindow.tsx`

Текущий `loadHistory` (строки 104–141) делает только `api.getMessages()` и не читает IDB.
Нужно изменить его так, чтобы:
1. При открытии чата сначала читать из IDB (мгновенная отдача)
2. Затем фоново синхронизировать с сервером
3. При ошибке сети не падать (тихо оставаться с кэшем)
4. При успешной синхронизации обновлять IDB

- [ ] **Step 6.1: Добавить импорты в ChatWindow.tsx**

Добавить в начало файла (после существующих импортов):
```typescript
import { loadMessages, appendMessages, saveMessages } from '@/store/messageDb'
```

- [ ] **Step 6.2: Заменить loadHistory**

Найти функцию `loadHistory` (строки 104–141) и заменить её полностью:

```typescript
  const loadHistory = useCallback(async (id: string) => {
    if (historyLoaded.current.has(id)) return
    historyLoaded.current.add(id)
    setLoadingHistory(true)

    // Шаг 1: загрузить из IDB мгновенно
    const cached = await loadMessages(id)
    if (cached.length > 0) {
      prependMessages(id, cached)
      setLoadingHistory(false)
    }

    // Шаг 2: фоновая синхронизация с сервером
    try {
      const { messages: msgs } = await api.getMessages(id, { limit: 50 })
      if (msgs.length > 0) {
        const decoded = await Promise.all(msgs.map(async (m) => {
          let raw = tryDecode(m.encryptedPayload)
          try {
            const isGroupPayload = (() => {
              try { return JSON.parse(atob(m.encryptedPayload))?.type === 'group' } catch { return false }
            })()
            raw = isGroupPayload
              ? await decryptGroupMessage(id, m.senderId, m.encryptedPayload)
              : await decryptMessage(id, m.senderId, m.encryptedPayload)
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
        // Обновить IDB свежими данными с сервера
        await saveMessages(id, decoded)
      }
    } catch {
      // Нет сети или другая ошибка — остаёмся с кэшем из IDB
    } finally {
      setLoadingHistory(false)
    }
  }, [prependMessages])
```

Важно: добавить `prependMessages` в dependency array (было `[]`).

- [ ] **Step 6.3: Сохранять отправленные сообщения в IDB**

В `ChatWindow.tsx` найти место где добавляется optimistic message при отправке. Это в функции `handleSend` (примерно строки 200–270, смотреть по вызову `addMessage` и `wsSend`).

Найти вызов `addMessage(optimisticMsg, ...)` в handleSend и добавить после него:
```typescript
appendMessages(chatId, [optimisticMsg]).catch(() => {})
```

Убедиться что `appendMessages` уже импортирован (добавили на шаге 6.1).

- [ ] **Step 6.4: Проверить type-check и lint**

```bash
cd client && npm run type-check && npm run lint
```

- [ ] **Step 6.5: Коммит**

```bash
git add src/components/ChatWindow/ChatWindow.tsx
git commit -m "feat(offline): загружать историю из IDB, фоновая синхронизация с сервером"
```

---

## Task 7: Загружать список чатов из IDB в ChatListPage

**Files:**
- Modify: `client/src/pages/ChatListPage.tsx`
- Modify: `client/src/store/chatStore.ts`

- [ ] **Step 7.1: Добавить saveChats в chatStore**

В `chatStore.ts` добавить импорт и автоматическое сохранение чатов при `setChats`:

Добавить в начало файла:
```typescript
import { saveChats } from '@/store/messageDb'
```

Найти `setChats: (chats) => set({ chats }),` и заменить:
```typescript
  setChats: (chats) => {
    set({ chats })
    // Персистировать список чатов в IndexedDB для offline-доступа
    saveChats(chats).catch(() => {})
  },
```

- [ ] **Step 7.2: Загружать чаты из IDB в ChatListPage**

В `ChatListPage.tsx` добавить импорт:
```typescript
import { loadChats } from '@/store/messageDb'
```

Найти текущий `useEffect` (строки 18–22):
```typescript
  useEffect(() => {
    api.getChats().then((res) => {
      setChats(res.chats as unknown as Chat[])
    }).catch(() => {/* токен мог истечь — тихо игнорируем */})
  }, [setChats])
```

Заменить на:
```typescript
  useEffect(() => {
    // Шаг 1: загрузить из IDB мгновенно
    loadChats().then((cached) => {
      if (cached.length > 0) setChats(cached)
    }).catch(() => {})

    // Шаг 2: фоновая синхронизация с сервером
    api.getChats().then((res) => {
      setChats(res.chats as unknown as Chat[])
    }).catch(() => {/* offline или токен истёк — используем кэш */})
  }, [setChats])
```

- [ ] **Step 7.3: Проверить type-check и lint**

```bash
cd client && npm run type-check && npm run lint
```

- [ ] **Step 7.4: Коммит**

```bash
git add src/pages/ChatListPage.tsx src/store/chatStore.ts
git commit -m "feat(offline): загружать список чатов из IDB при старте"
```

---

## Task 8: useOfflineSync — сбросить outbox при восстановлении WS

**Files:**
- Create: `client/src/hooks/useOfflineSync.ts`

- [ ] **Step 8.1: Создать хук**

```typescript
/**
 * Хук для автоматической повторной отправки сообщений из outbox при восстановлении WS.
 *
 * Срабатывает при смене wsSend с null на функцию (WS подключился).
 * Загружает очередь из outboxDb, отправляет каждый элемент и удаляет из очереди.
 */

import { useEffect, useRef } from 'react'
import { useWsStore } from '@/store/wsStore'
import { useChatStore } from '@/store/chatStore'
import { loadOutbox, removeFromOutbox } from '@/store/outboxDb'

export function useOfflineSync(): void {
  const wsSend = useWsStore((s) => s.send)
  const updateMessageStatus = useChatStore((s) => s.updateMessageStatus)
  const prevSendRef = useRef<typeof wsSend>(null)

  useEffect(() => {
    // Сброс outbox только при переходе null → функция (WS только что подключился)
    const wasNull = prevSendRef.current === null
    prevSendRef.current = wsSend

    if (!wsSend || !wasNull) return

    // WS только что восстановился — сбрасываем очередь
    loadOutbox().then((items) => {
      if (items.length === 0) return
      console.log(`[offline-sync] Отправка ${items.length} сообщений из outbox`)
      items.forEach((item) => {
        const sent = wsSend(item.frame)
        if (sent) {
          removeFromOutbox(item.id).catch(() => {})
          updateMessageStatus(item.chatId, item.id, 'sent')
        }
      })
    }).catch((e) => console.error('[offline-sync] Ошибка загрузки outbox', e))
  }, [wsSend, updateMessageStatus])
}
```

- [ ] **Step 8.2: Проверить type-check**

```bash
cd client && npm run type-check
```

- [ ] **Step 8.3: Коммит**

```bash
git add src/hooks/useOfflineSync.ts
git commit -m "feat(offline): добавить useOfflineSync — сброс outbox при восстановлении WS"
```

---

## Task 9: Интегрировать outbox в ChatWindow при отправке сообщений

**Files:**
- Modify: `client/src/components/ChatWindow/ChatWindow.tsx`

Текущий код (`pendingQueue.current`) хранит очередь только в памяти. При перезагрузке страницы очередь теряется. Нужно добавить сохранение в `outboxDb` и убрать зависимость от in-memory `pendingQueue` для offline-случая.

- [ ] **Step 9.1: Добавить импорт outboxDb в ChatWindow.tsx**

Добавить импорт в начало файла:
```typescript
import { enqueueOutbox } from '@/store/outboxDb'
```

- [ ] **Step 9.2: Модифицировать логику отправки в handleSend**

В `ChatWindow.tsx` найти место где вызывается `wsSend(frame)` или сообщение добавляется в `pendingQueue`. Это примерно строки 240–280 (функция `handleSend`).

Найти код вида:
```typescript
    const sent = wsSend?.(frame)
    if (!sent) {
      pendingQueue.current.push(frame)
    }
```

Если pattern другой — найти вызов `wsSend` и `pendingQueue.current.push`. Заменить на:
```typescript
    const sent = wsSend?.(frame) ?? false
    if (!sent) {
      // WS недоступен — сохранить в персистентный outbox
      enqueueOutbox({
        id: clientMsgId,
        chatId,
        frame: frame as OutboxItem['frame'],
        optimisticMsg,
        enqueuedAt: Date.now(),
      }).catch(() => {})
    }
```

Добавить в начало файла импорт типа:
```typescript
import type { OutboxItem } from '@/store/outboxDb'
```

**Замечание о `pendingQueue`:** после этого изменения `pendingQueue.current` можно оставить для немедленной повторной отправки при переходе offline→online в пределах одной сессии (без перезагрузки). `outboxDb` покрывает случай перезагрузки. Оба механизма работают независимо, дедупликация через `clientMsgId` на сервере.

- [ ] **Step 9.3: Найти фактический код handleSend для применения изменений**

Прочитать ChatWindow.tsx строки 198–320 чтобы найти точное место вызова wsSend:

```bash
grep -n "wsSend\|pendingQueue" client/src/components/ChatWindow/ChatWindow.tsx
```

Применить изменения по фактическому содержимому файла.

- [ ] **Step 9.4: Проверить type-check и lint**

```bash
cd client && npm run type-check && npm run lint
```

- [ ] **Step 9.5: Коммит**

```bash
git add src/components/ChatWindow/ChatWindow.tsx
git commit -m "feat(offline): сохранять неотправленные сообщения в персистентный outbox"
```

---

## Task 10: Собрать всё в App.tsx + обновить Workbox стратегию

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/vite.config.ts`

- [ ] **Step 10.1: Подключить useOfflineSync и OfflineIndicator в App.tsx**

Найти `App.tsx` и добавить импорты:
```typescript
import { useOfflineSync } from '@/hooks/useOfflineSync'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'
```

В функции `AppRoutes` добавить вызов хука:
```typescript
function AppRoutes() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useMessengerWS()
  useOfflineSync()   // ← добавить
  // ...
```

В функции `App` добавить компонент:
```typescript
export default function App() {
  return (
    <BrowserRouter>
      <OfflineIndicator />   {/* ← добавить */}
      <AppRoutes />
    </BrowserRouter>
  )
}
```

- [ ] **Step 10.2: Обновить Workbox стратегию в vite.config.ts**

В `vite.config.ts` найти блок `workbox.runtimeCaching` и обновить NetworkFirst для API:

```typescript
      workbox: {
        importScripts: ['/push-handler.js'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'messenger-api',
              networkTimeoutSeconds: 5,  // ← добавить: не ждать более 5с при плохой сети
            }
          },
          {
            urlPattern: /^\/media\//,
            handler: 'CacheFirst',
            options: { cacheName: 'messenger-media' }
          }
        ]
      },
```

- [ ] **Step 10.3: Проверить type-check и lint**

```bash
cd client && npm run type-check && npm run lint
```

- [ ] **Step 10.4: Сделать production build и убедиться что нет ошибок**

```bash
cd client && npm run build
```

Ожидание: build успешен, `dist/` содержит `sw.js` с workbox.

- [ ] **Step 10.5: Финальный коммит**

```bash
git add src/App.tsx vite.config.ts
git commit -m "feat(offline): подключить OfflineIndicator и useOfflineSync в App, обновить Workbox"
```

---

## Завершающий шаг: обновить чеклисты

- [ ] **Step 11.1: Обновить spec-gap-checklist.md**

В `docs/spec-gap-checklist.md` отметить:
- `[x] Реализовать offline history viewing`
- `[x] Добавить полноценный offline sync слой поверх IndexedDB`
- `[x] Добавить UI-индикацию offline состояния`

- [ ] **Step 11.2: Обновить v1-gap-remediation.md**

В `docs/v1-gap-remediation.md` пометить Этап 6 как закрытый:
```
## Этап 6. Offline/PWA слой ✅ Закрыт
```

- [ ] **Step 11.3: Финальный docs-коммит**

```bash
git add docs/spec-gap-checklist.md docs/v1-gap-remediation.md
git commit -m "docs: отметить этап 6 (offline/PWA) как закрытый"
```

---

## Self-Review

### Покрытие требований (из v1-gap-remediation.md Этап 6):

| Требование | Task |
|---|---|
| IndexedDB persistence для истории | Task 1, Task 5, Task 6 |
| Offline sync queue | Task 2, Task 9 |
| Background resend исходящих | Task 8 |
| Service Worker стратегия | Task 10 |
| UI-индикация offline состояния | Task 3, Task 4, Task 10 |

### Покрытие чеклиста (spec-gap-checklist.md):

| Пункт | Task |
|---|---|
| Реализовать offline history viewing | Task 6, Task 7 |
| Добавить полноценный offline sync слой поверх IndexedDB | Task 8, Task 9 |

### Проверка плейсхолдеров: нет TBD или TODO в коде.

### Проверка типов:
- `OutboxItem` используется в Task 2, 9, 8 — определён в outboxDb.ts, импортируется явно.
- `Message` из `@/types` — доступен везде.
- `appendMessages`, `saveMessages`, `loadMessages`, `saveChats`, `loadChats` — определены в Task 1, используются в Tasks 5, 6, 7.
- `enqueueOutbox`, `loadOutbox`, `removeFromOutbox` — определены в Task 2, используются в Tasks 8, 9.
- `useNetworkStatus` — определён в Task 3, используется в Task 4.
- `useOfflineSync` — определён в Task 8, используется в Task 10.
