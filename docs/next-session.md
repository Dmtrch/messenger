# План на следующую сессию

Актуально на: 2026-04-12 19:45
Ветка: `main`

## Следующий приоритет

Подготовить следующий shared/native adapter этап — уменьшение browser-only границ перед non-web adapters.

## Что делать дальше

1. Усилить интеграцию call stack с общим realtime runtime
   - проверить, какие call-specific browser эффекты ещё живут в consumer-слое
   - свести runtime boundaries к shared controller + browser adapters без лишней React-логики

2. Подготовить `shared/native-core` к desktop/android/ios adapters
   - продолжить уменьшать browser-only зависимости в call/web и websocket/web
   - проверить, какие browser runtime factories ещё можно вынести из компонентов

3. Возможные follow-up задачи по текущему рефакторингу (не блокируют):
   - Thread `bindingsRef` через `createBrowserWSWiring` для hot-path freshness (сейчас Zustand-actions стабильны — практического импакта нет)
   - Переместить `useChatStore.getState()` action-деструктуринг внутрь `useMemo` в `useBrowserWSBindings`

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
- **`client/src/App.tsx`** — wired up `useBrowserWSBindings` + `useMessengerWS(browserApiClient, bindings)`

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
