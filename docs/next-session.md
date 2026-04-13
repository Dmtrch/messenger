# План на следующую сессию

Актуально на: 2026-04-13 08:55
Ветка: `main`

## Следующий приоритет

Stage 11C — Desktop client. Browser runtime слой завершён, следующий шаг — первый нативный клиент.

## Что делать дальше

1. **Stage 11C — Desktop** (следующий крупный этап)
   - Brainstorm архитектуру desktop-клиента (Compose Multiplatform или Electron)
   - Создать `apps/desktop/` каркас
   - Реализовать non-browser адаптеры для `WSClient`, `CryptoEngine`, `MessageRepository`
   - Переиспользовать `shared/native-core` как есть

2. Возможные мелкие доработки (не блокируют):
   - Thread `bindingsRef` через `createBrowserWSWiring` для hot-path freshness (сейчас Zustand-actions стабильны — практического импакта нет)

## Stage 11B — Browser Runtime: завершён ✅

Все browser-only зависимости вынесены из consumer-слоя:

| Хук | До | После |
|-----|----|-------|
| `useMessengerWS` | импортировал api/client, authStore, chatStore, wsStore, 7 crypto-функций | принимает `(apiClient, bindings)`, нет store/crypto импортов |
| `useWebRTC` | импортировал `api` из api/client | принимает `apiClient: BrowserApiClient` |
| `useCallHandler` | нет зависимостей на api/client | принимает `apiClient: BrowserApiClient`, передаёт в useWebRTC |
| `useBrowserWSBindings` | консолидирует все store/crypto deps | action-деструктуринг внутри useMemo |

## Что уже завершено и не трогать повторно

- `shared/native-core/calls/call-session.ts`
- `shared/native-core/calls/call-controller.ts`
- `shared/native-core/calls/web/browser-webrtc-runtime.ts`
- `shared/native-core/calls/web/call-handler-orchestrator.ts`
- `client/src/store/callStore.ts` как adapter-store
- `client/src/hooks/useCallHandler.ts`
- `client/src/hooks/useWebRTC.ts`
- удаление legacy bridge callbacks из `callStore`
- top-level wiring `call-controller` через `App.tsx`
- `shared/native-core/websocket/web/*` без зависимости от `client/src/types`
- `client/src/api/websocket.ts` и `client/src/store/wsStore.ts` на shared websocket type surface
- shared browser platform helpers для `WebSocket`, browser timers, `RTCPeerConnection` и `getUserMedia`
- shared browser deps helper для `useMessengerWS`
- **`shared/native-core/websocket/web/browser-ws-wiring.ts`** — `createBrowserWSWiring` factory + `BrowserWSBindings` type (6 unit tests)
- **`client/src/hooks/useBrowserWSBindings.ts`** — консолидация store + crypto deps в одном хуке
- **`client/src/hooks/useMessengerWS.ts`** — упрощён: принимает `(apiClient, bindings)`, bindingsRef, нет store/crypto импортов
- **`client/src/api/client.ts`** — добавлен `export const browserApiClient`
- **`client/src/App.tsx`** — wired up `useBrowserWSBindings` + `useMessengerWS(browserApiClient, bindings)` + `useCallHandler(browserApiClient)`
- **`client/src/hooks/useWebRTC.ts`** — убран импорт `api/client`, принимает `apiClient: BrowserApiClient`
- **`client/src/hooks/useCallHandler.ts`** — принимает `apiClient: BrowserApiClient`, передаёт в `useWebRTC`
- `useBrowserWSBindings` — action-деструктуринг внутри `useMemo` (корректен по construction)

## Ключевые документы

- `docs/superpowers/specs/2026-04-12-call-state-machine-design.md`
- `docs/superpowers/plans/2026-04-12-browser-ws-wiring.md` (выполнен)
- `docs/architecture.md`
- `docs/technical-documentation.md`

## Обязательная проверка после следующего шага

1. `cd client && npm run type-check`
2. `cd client && npm test -- shared/native-core/websocket/web/browser-ws-wiring.test.ts`
3. `cd client && npm test -- src/api/client.test.ts`
4. при изменениях вне call-стека — расширенный shared/client regression run

## Напоминание для следующего старта

Не возвращаться к реализации WS wiring как к незавершённым задачам — рефакторинг `useMessengerWS` полностью завершён.

Следующий рабочий трек:
- следующий shared/native adapter этап
- усиление интеграции call stack с общим realtime runtime
- дальнейшее уменьшение browser-only границ перед non-web adapters
