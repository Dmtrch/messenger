# Browser WS Wiring Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать прямые зависимости `useMessengerWS` на `api/client`, `authStore` и `chatStore`, переместив сборку зависимостей оркестратора в shared browser factory и отдельный React-хук.

**Architecture:** Создаётся `createBrowserWSWiring` в `shared/native-core` — чистая функция, принимающая `BrowserApiClient` и `BrowserWSBindings` и возвращающая `MessengerWSOrchestratorDeps`. Параллельно создаётся `useBrowserWSBindings` в `client/` — React-хук, читающий сторы и собирающий `BrowserWSBindings`. `useMessengerWS` становится тонким lifecycle-хуком: принимает `(apiClient, bindings)`, использует `bindingsRef` чтобы не пересоздавать WS при каждом изменении callback-ссылок.

**Tech Stack:** TypeScript, React 18, Vitest, Zustand, shared/native-core (platform-neutral).

---

## Карта файлов

| Файл | Действие |
|------|----------|
| `shared/native-core/websocket/web/browser-ws-wiring.ts` | НОВЫЙ — фабрика `createBrowserWSWiring` + тип `BrowserWSBindings` |
| `shared/native-core/websocket/web/browser-ws-wiring.test.ts` | НОВЫЙ — unit-тесты фабрики |
| `shared/native-core/index.ts` | ИЗМЕНИТЬ — добавить экспорты |
| `client/src/hooks/useBrowserWSBindings.ts` | НОВЫЙ — React-хук, читает сторы |
| `client/src/hooks/useMessengerWS.ts` | ИЗМЕНИТЬ — убрать импорты сторов, новая сигнатура |
| `client/src/api/client.ts` | ИЗМЕНИТЬ — добавить `export const browserApiClient` |
| `client/src/App.tsx` | ИЗМЕНИТЬ — вызов двух хуков вместо одного |

---

### Task 1: `browser-ws-wiring.ts` — shared factory (TDD)

**Files:**
- Create: `shared/native-core/websocket/web/browser-ws-wiring.test.ts`
- Create: `shared/native-core/websocket/web/browser-ws-wiring.ts`

#### Контекст для выполнения

`MessengerWSOrchestratorDeps` (`shared/native-core/websocket/web/messenger-ws-orchestrator.ts`) — полный набор зависимостей оркестратора. `BrowserWSBindings` = все поля `MessengerWSOrchestratorDeps` КРОМЕ четырёх, которые factory вычисляет сам: `getChats`, `uploadPreKeys`, `clearAccessToken`, `schedule`. Плюс два дополнительных поля: `token: string | null` и `isAuthenticated: boolean`.

`BrowserApiClient` определён в `shared/native-core/api/web/browser-api-client.ts`. Интерфейс:
```ts
interface BrowserApiClient {
  api: { getChats(): Promise<{ chats: ChatSummary[] }>; uploadPreKeys(keys: Array<{ id: number; key: string }>): Promise<void>; /* ... */ }
  setAccessToken(token: string | null): void
}
```

`mapChatSummariesToRealtimeChats` и `scheduleBrowserRealtimeTask` уже есть в `shared/native-core/websocket/web/browser-messenger-ws-deps.ts`.

- [ ] **Step 1: Написать тест (falling first)**

Создать файл `shared/native-core/websocket/web/browser-ws-wiring.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { BrowserApiClient } from '../../api/web/browser-api-client'
import type { BrowserWSBindings } from './browser-ws-wiring'
import { createBrowserWSWiring } from './browser-ws-wiring'

function makeApiClient(overrides: Partial<{ getChats: ReturnType<typeof vi.fn>; uploadPreKeys: ReturnType<typeof vi.fn> }> = {}): BrowserApiClient {
  return {
    api: {
      getChats: overrides.getChats ?? vi.fn().mockResolvedValue({ chats: [] }),
      uploadPreKeys: overrides.uploadPreKeys ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserApiClient['api'],
    setAccessToken: vi.fn(),
  }
}

function makeBindings(overrides: Partial<BrowserWSBindings> = {}): BrowserWSBindings {
  return {
    token: 'test-token',
    isAuthenticated: true,
    currentUserId: 'user-1',
    logout: vi.fn(),
    getCallFrameHandler: vi.fn().mockReturnValue(null),
    addMessage: vi.fn(),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    updateMessageStatus: vi.fn(),
    setTyping: vi.fn(),
    upsertChat: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    markRead: vi.fn(),
    getKnownChat: vi.fn().mockReturnValue(null),
    getMessagesForChat: vi.fn().mockReturnValue([]),
    setSend: vi.fn(),
    decryptMessage: vi.fn().mockResolvedValue(''),
    decryptGroupMessage: vi.fn().mockResolvedValue(''),
    handleIncomingSKDM: vi.fn().mockResolvedValue(undefined),
    tryDecryptPreview: vi.fn().mockResolvedValue(''),
    appendOneTimePreKeys: vi.fn().mockResolvedValue([]),
    savePreKeyReplenishTime: vi.fn().mockResolvedValue(undefined),
    isPreKeyReplenishOnCooldown: vi.fn().mockResolvedValue(false),
    generateDHKeyPair: vi.fn().mockReturnValue({ publicKey: new Uint8Array(32) }),
    toBase64: vi.fn().mockReturnValue('base64'),
    ...overrides,
  }
}

describe('createBrowserWSWiring', () => {
  it('вызывает setAccessToken с token из bindings при создании', () => {
    const client = makeApiClient()
    createBrowserWSWiring(client, makeBindings({ token: 'tok-abc' }))
    expect(client.setAccessToken).toHaveBeenCalledWith('tok-abc')
  })

  it('clearAccessToken вызывает setAccessToken(null)', () => {
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings())
    wiring.clearAccessToken()
    expect(client.setAccessToken).toHaveBeenCalledWith(null)
  })

  it('getChats вызывает api.getChats и преобразует ChatSummary → RealtimeChat', async () => {
    const chatSummary = {
      id: 'c1',
      type: 'direct' as const,
      name: 'Test',
      members: ['u1', 'u2'],
      unreadCount: 0,
      updatedAt: 1000,
    }
    const client = makeApiClient({
      getChats: vi.fn().mockResolvedValue({ chats: [chatSummary] }),
    })
    const wiring = createBrowserWSWiring(client, makeBindings())
    const result = await wiring.getChats()
    expect(result.chats).toHaveLength(1)
    expect(result.chats[0].id).toBe('c1')
    expect(result.chats[0].type).toBe('direct')
  })

  it('uploadPreKeys делегирует api.uploadPreKeys', async () => {
    const uploadMock = vi.fn().mockResolvedValue(undefined)
    const client = makeApiClient({ uploadPreKeys: uploadMock })
    const wiring = createBrowserWSWiring(client, makeBindings())
    const keys = [{ id: 1, key: 'abc' }]
    await wiring.uploadPreKeys(keys)
    expect(uploadMock).toHaveBeenCalledWith(keys)
  })

  it('поля из bindings передаются без изменений', () => {
    const addMsg = vi.fn()
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings({ addMessage: addMsg }))
    expect(wiring.addMessage).toBe(addMsg)
  })

  it('schedule вызывает setTimeout с правильным delay', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings())
    const run = vi.fn()
    wiring.schedule(500, run)
    expect(setTimeoutSpy).toHaveBeenCalledWith(run, 500)
    setTimeoutSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
cd client && npm test -- --dir .. shared/native-core/websocket/web/browser-ws-wiring.test.ts
```

Ожидается: `FAIL` — `Cannot find module './browser-ws-wiring'`

- [ ] **Step 3: Создать `browser-ws-wiring.ts`**

Создать файл `shared/native-core/websocket/web/browser-ws-wiring.ts`:

```ts
import type { BrowserApiClient } from '../../api/web/browser-api-client'
import type { MessengerWSOrchestratorDeps } from './messenger-ws-orchestrator'
import { mapChatSummariesToRealtimeChats, scheduleBrowserRealtimeTask } from './browser-messenger-ws-deps'

export interface BrowserWSBindings extends Omit<
  MessengerWSOrchestratorDeps,
  'getChats' | 'uploadPreKeys' | 'clearAccessToken' | 'schedule'
> {
  /** JWT токен текущей сессии — передаётся в apiClient.setAccessToken при создании wiring. */
  token: string | null
  /** Флаг для guard в useEffect: не создавать WS если не аутентифицирован. */
  isAuthenticated: boolean
}

/**
 * Собирает полный MessengerWSOrchestratorDeps из BrowserApiClient + BrowserWSBindings.
 *
 * Factory отвечает за четыре browser/API-специфичных поля:
 * - clearAccessToken → apiClient.setAccessToken(null)
 * - getChats        → apiClient.api.getChats() + маппинг ChatSummary → RealtimeChat
 * - uploadPreKeys   → apiClient.api.uploadPreKeys
 * - schedule        → scheduleBrowserRealtimeTask(setTimeout, ...)
 *
 * Все остальные поля берутся из bindings без изменений.
 * Вызывает apiClient.setAccessToken(bindings.token) немедленно при создании.
 */
export function createBrowserWSWiring(
  apiClient: BrowserApiClient,
  bindings: BrowserWSBindings,
): MessengerWSOrchestratorDeps {
  apiClient.setAccessToken(bindings.token)

  // Деструктурируем поля, которые не входят в MessengerWSOrchestratorDeps
  const { token: _token, isAuthenticated: _isAuthenticated, ...passthrough } = bindings

  return {
    ...passthrough,
    clearAccessToken() {
      apiClient.setAccessToken(null)
    },
    async getChats() {
      const result = await apiClient.api.getChats()
      return { chats: mapChatSummariesToRealtimeChats(result.chats) }
    },
    uploadPreKeys: (keys) => apiClient.api.uploadPreKeys(keys),
    schedule(delayMs, run) {
      return scheduleBrowserRealtimeTask(setTimeout, delayMs, run)
    },
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
cd client && npm test -- --dir .. shared/native-core/websocket/web/browser-ws-wiring.test.ts
```

Ожидается: `PASS` — 6 тестов зелёные.

- [ ] **Step 5: Добавить экспорты в `shared/native-core/index.ts`**

Открыть `shared/native-core/index.ts`. Найти строку с `createMessengerWSOrchestrator` и добавить рядом:

```ts
export { createBrowserWSWiring } from './websocket/web/browser-ws-wiring'
export type { BrowserWSBindings } from './websocket/web/browser-ws-wiring'
```

Вставить сразу после существующей строки:
```ts
export { createMessengerWSOrchestrator } from './websocket/web/messenger-ws-orchestrator'
```

- [ ] **Step 6: Проверить что package-entry тест проходит**

```bash
cd client && npm test -- --dir .. shared/native-core/package-entry.test.ts
```

Ожидается: `PASS`.

- [ ] **Step 7: Commit**

```bash
git add shared/native-core/websocket/web/browser-ws-wiring.ts \
        shared/native-core/websocket/web/browser-ws-wiring.test.ts \
        shared/native-core/index.ts
git commit -m "feat(shared): browser WS wiring factory — createBrowserWSWiring + BrowserWSBindings"
```

---

### Task 2: `useBrowserWSBindings.ts` — React-хук сборки bindings

**Files:**
- Create: `client/src/hooks/useBrowserWSBindings.ts`

#### Контекст

Этот хук консолидирует все подписки на Zustand-сторы и crypto-зависимости в одном месте. После его создания `useMessengerWS` больше не нужно знать про `authStore`, `chatStore`, `wsStore`, crypto.

Важно: `getKnownChat` и `getMessagesForChat` используют `useChatStore.getState()` (прямой доступ без подписки) — чтобы оркестратор всегда читал актуальное состояние без пересоздания WS. Это текущее поведение хука — не менять.

`appendMessages` импортируется из `@/store/messageDb`. Его тип `(chatId: string, newMsgs: Message[]) => Promise<void>` структурно совместим с `MessengerWSOrchestratorDeps.appendMessages` (типы `Message` и `RealtimeMessage` идентичны).

- [ ] **Step 1: Создать `useBrowserWSBindings.ts`**

```ts
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
```

- [ ] **Step 2: Проверить типы**

```bash
cd client && npm run type-check 2>&1 | head -30
```

Ожидается: ошибок нет (файл не используется пока — это нормально).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useBrowserWSBindings.ts
git commit -m "feat(client): useBrowserWSBindings — консолидация зависимостей WS из сторов"
```

---

### Task 3: Упростить `useMessengerWS.ts`

**Files:**
- Modify: `client/src/hooks/useMessengerWS.ts`

#### Контекст

После рефактора `useMessengerWS` принимает `(apiClient: BrowserApiClient, bindings: BrowserWSBindings)` и больше не импортирует сторы, `api/client`, или crypto напрямую.

Ключевой паттерн — `bindingsRef`:
- `bindingsRef.current = bindings` обновляется при каждом рендере (синхронно)
- `useEffect` запускается ТОЛЬКО при изменении `apiClient`, `isAuthenticated`, `token`, `currentUserId`
- Оркестратор создаётся с `bindingsRef.current` → получает свежие callback-ссылки на момент подключения
- Callback-и (addMessage, etc.) живут в closures внутри оркестратора, они стабильны из Zustand

Это исправляет потенциальный баг текущей версии: раньше useEffect зависел от 13 props и пересоздавал WS при каждом изменении функций из useChatStore.

Текущий `useMessengerWS.ts`:
```ts
import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import { setAccessToken, api } from '@/api/client'         // УБРАТЬ
import { useChatStore } from '@/store/chatStore'            // УБРАТЬ
import { useAuthStore } from '@/store/authStore'            // УБРАТЬ
import { useWsStore } from '@/store/wsStore'                // УБРАТЬ
import { decryptMessage, decryptGroupMessage, ... }         // УБРАТЬ
import { appendOneTimePreKeys, ... }                        // УБРАТЬ
import { generateDHKeyPair, toBase64 }                      // УБРАТЬ
import { appendMessages } from '@/store/messageDb'          // УБРАТЬ
import { createMessengerWSOrchestrator, mapChatSummariesToRealtimeChats, scheduleBrowserRealtimeTask, type CallWSFrame } from '../../../shared/native-core'
```

- [ ] **Step 1: Полностью заменить содержимое `useMessengerWS.ts`**

```ts
// client/src/hooks/useMessengerWS.ts

import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import {
  createBrowserWSWiring,
  createMessengerWSOrchestrator,
  type BrowserWSBindings,
  type BrowserApiClient,
} from '../../../shared/native-core'

/**
 * Lifecycle-хук WebSocket-соединения мессенджера.
 *
 * Принимает apiClient и bindings (из useBrowserWSBindings).
 * Не импортирует сторы или api/client напрямую.
 *
 * WS пересоздаётся только при изменении token/isAuthenticated/currentUserId.
 * Свежие callback-ссылки из bindings доступны через bindingsRef без лишних reconnects.
 */
export function useMessengerWS(
  apiClient: BrowserApiClient,
  bindings: BrowserWSBindings,
) {
  const wsRef      = useRef<MessengerWS | null>(null)
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    if (!bindings.isAuthenticated || !bindings.token) return

    const deps        = createBrowserWSWiring(apiClient, bindingsRef.current)
    const orchestrator = createMessengerWSOrchestrator(deps)

    const ws = new MessengerWS(
      bindings.token,
      (frame) => { void orchestrator.onFrame(frame) },
      () => { orchestrator.onConnect((frame) => ws.send(frame)) },
      () => { orchestrator.onDisconnect() },
      () => { orchestrator.onAuthFail() },
    )

    ws.connect()
    wsRef.current = ws

    return () => {
      ws.disconnect()
      wsRef.current = null
      bindingsRef.current.setSend(null)
    }
  }, [apiClient, bindings.isAuthenticated, bindings.token, bindings.currentUserId])

  return wsRef
}
```

- [ ] **Step 2: Проверить типы**

```bash
cd client && npm run type-check 2>&1 | head -30
```

Ожидается ошибка в `App.tsx`: `useMessengerWS` вызывается со старой сигнатурой — это нормально, исправим в Task 4.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useMessengerWS.ts
git commit -m "refactor(client): useMessengerWS — убрать импорты сторов, принимать apiClient + bindings"
```

---

### Task 4: Подключить в `App.tsx` + экспорт `browserApiClient`

**Files:**
- Modify: `client/src/api/client.ts` (строки 21-35)
- Modify: `client/src/App.tsx`

#### Контекст

`client.ts` создаёт `BrowserApiClient` через `createBrowserApiClient(...)`. Сейчас он экспортирует только `api`, `setAccessToken`, `uploadEncryptedMedia` из этого объекта. Нужно добавить `export const browserApiClient = client` чтобы `App.tsx` мог передать полный объект.

`App.tsx` — `AppRoutes` компонент сейчас:
```ts
useMessengerWS(handleCallFrame)
```

Станет:
```ts
const bindings = useBrowserWSBindings(handleCallFrame)
useMessengerWS(browserApiClient, bindings)
```

Тип `handleCallFrame` сейчас `Parameters<typeof useMessengerWS>[0]` — это ссылка на первый параметр старой сигнатуры. После рефактора нужно заменить на явный тип `(frame: CallWSFrame) => void`.

- [ ] **Step 1: Добавить `browserApiClient` в `client/src/api/client.ts`**

Открыть файл. Найти строку:
```ts
export const api = client.api
```

Добавить после неё:
```ts
export const browserApiClient = client
```

Итоговый блок экспортов (строки ~31-35):
```ts
export const api = client.api
export const browserApiClient = client
export const setAccessToken = client.setAccessToken
export const uploadEncryptedMedia = client.api.uploadEncryptedMedia
```

- [ ] **Step 2: Обновить `client/src/App.tsx`**

Полное содержимое после изменений:

```ts
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useBrowserWSBindings } from '@/hooks/useBrowserWSBindings'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
import { browserApiClient } from '@/api/client'
import { initServerUrl, hasServerUrl } from '@/config/serverConfig'
import ChatListPage from '@/pages/ChatListPage'
import ChatWindowPage from '@/pages/ChatWindowPage'
import ProfilePage from '@/pages/ProfilePage'
import AuthPage from '@/pages/AuthPage'
import ServerSetupPage from '@/pages/ServerSetupPage'
import AdminPage from '@/pages/AdminPage'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'
import CallOverlay from '@/components/CallOverlay/CallOverlay'
import type { CallWSFrame } from '../../../shared/native-core'

// Инициализируем URL сервера при загрузке модуля (если не задан — берём window.location.origin)
initServerUrl()

interface AppRoutesProps {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
  handleCallFrame: ((frame: CallWSFrame) => void) | null
}

function AppRoutes({ initiateCall, handleCallFrame }: AppRoutesProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.role)

  // Сборка зависимостей WS из сторов
  const bindings = useBrowserWSBindings(handleCallFrame)
  // WebSocket подключается глобально при авторизации
  useMessengerWS(browserApiClient, bindings)
  // Сброс outbox при восстановлении WS-соединения
  useOfflineSync()

  // Если URL сервера не задан — показываем setup
  if (!hasServerUrl()) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<ChatListPage />} />
      <Route path="/chat/:chatId" element={<ChatWindowPage initiateCall={initiateCall} />} />
      <Route path="/profile" element={<ProfilePage />} />
      {role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const {
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    handleCallFrame,
  } = useCallHandler()

  return (
    <BrowserRouter>
      <OfflineIndicator />
      <AppRoutes initiateCall={initiateCall} handleCallFrame={handleCallFrame} />
      <CallOverlay onAccept={acceptCall} onReject={rejectCall} onHangUp={hangUp} />
    </BrowserRouter>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd client && npm run type-check 2>&1 | head -40
```

Ожидается: 0 ошибок.

- [ ] **Step 4: Lint**

```bash
cd client && npm run lint 2>&1 | head -20
```

Ожидается: 0 warnings.

- [ ] **Step 5: Запустить все тесты**

```bash
cd client && npm test -- --dir .. \
  shared/native-core/websocket/web/browser-ws-wiring.test.ts \
  shared/native-core/package-entry.test.ts
```

Ожидается: все тесты PASS.

```bash
cd client && npm test -- src/api/client.test.ts
```

Ожидается: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/api/client.ts client/src/App.tsx
git commit -m "feat(client): подключить browserApiClient + useBrowserWSBindings в App.tsx"
```

---

## Проверка после всех задач

Убедиться что всё работает целиком:

```bash
# Full type-check
cd client && npm run type-check

# All related tests
cd client && npm test -- --dir .. \
  shared/native-core/websocket/web/browser-ws-wiring.test.ts \
  shared/native-core/package-entry.test.ts

# Client tests
cd client && npm test -- src/api/client.test.ts src/crypto/ratchet.test.ts
```

---

## Итог: что изменилось

| До | После |
|----|-------|
| `useMessengerWS` импортирует `api/client`, `authStore`, `chatStore`, `wsStore`, 7 crypto-функций | `useMessengerWS` знает только о `BrowserApiClient`, `BrowserWSBindings`, `MessengerWS` |
| WS пересоздаётся при любом изменении из 13 deps (включая callback-ссылки) | WS пересоздаётся только при `token` / `isAuthenticated` / `currentUserId` / `apiClient` |
| Сборка зависимостей оркестратора — inline в хуке | Сборка — в `createBrowserWSWiring` (тестируемая чистая функция) |
| Сторы подписаны внутри `useMessengerWS` | Сторы подписаны в `useBrowserWSBindings` — отдельный хук с единственной ответственностью |
