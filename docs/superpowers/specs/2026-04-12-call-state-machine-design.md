# Call State Machine Design

## Контекст

В клиенте логика звонков сейчас распределена между несколькими слоями:

- `client/src/store/callStore.ts` хранит состояние звонка, уведомления, mute/camera flags, `MediaStream` и transition-логику.
- `client/src/hooks/useCallHandler.ts` обрабатывает call-фреймы WebSocket и вызывает `useWebRTC`.
- `client/src/hooks/useWebRTC.ts` управляет `RTCPeerConnection`, `MediaStream`, ICE и одновременно пишет в Zustand.
- `client/src/components/CallOverlay/CallOverlay.tsx` и `client/src/components/ChatWindow/ChatWindow.tsx` читают состояние звонка напрямую из client store.

После уже выполненного выноса transport/orchestration в `shared/native-core` звонки остаются последним крупным realtime-срезом, где source-of-truth всё ещё находится в `client`.

## Цель

Вынести state machine звонка в `shared/native-core`, чтобы:

- общая логика статусов и переходов перестала жить в Zustand store;
- browser-specific части остались только в client adapters;
- `CallOverlay` и другие UI-экраны работали с нормализованным состоянием звонка;
- shared-слой закрывал не только transport/orchestration, но и call domain model.

## Неграницы

В этот этап не входят:

- вынос `MediaStream` в shared;
- вынос ringtone и DOM/video binding;
- редизайн UI экрана звонка;
- замена текущего signalling-протокола.

## Решение

### 1. Shared call session state machine

Добавляется новый доменный модуль `shared/native-core/calls/call-session.ts`.

Он отвечает только за состояние и переходы:

- `status`
- `callId`
- `chatId`
- `peerId`
- `isVideo`
- `incomingOffer`
- `notification`
- `isMuted`
- `isCameraOff`

Модуль не использует:

- `React`
- `Zustand`
- `MediaStream`
- `RTCPeerConnection`
- `setTimeout`
- browser globals

Он экспортирует:

- тип состояния звонка;
- начальное состояние;
- набор чистых transition-функций или reducer-style API;
- инварианты переходов.

### 2. Shared call controller

Добавляется orchestration-слой `shared/native-core/calls/call-controller.ts`.

Он связывает:

- call session state machine;
- `call-handler-orchestrator`;
- `browser-webrtc-runtime`;
- browser-neutral scheduling/notification hooks;
- adapter для публикации snapshot состояния наружу.

Контроллер не хранит `MediaStream`, но знает, когда:

- начать исходящий звонок;
- принять входящий offer;
- обработать `call_answer`;
- завершить звонок локально;
- отреагировать на `call_end`, `call_reject`, `call_busy`;
- поставить временное notification;
- обновить mute/camera flags.

### 3. Client store becomes adapter

`client/src/store/callStore.ts` перестаёт быть местом, где определяется поведение звонка.

Его новая роль:

- хранить текущий snapshot shared call session state;
- хранить `localStream` и `remoteStream`;
- хранить bridge callbacks для integration with existing screens;
- предоставлять простые setter’ы для browser media refs;
- применять обновления, пришедшие из shared controller.

### 4. Browser-specific media stays in client

`MediaStream` и browser media lifecycle остаются в `client`.

Причина:

- `MediaStream` делает shared-слой browser-bound;
- mobile/desktop runtime в будущем могут хранить media refs иначе;
- state machine должна быть независима от конкретного media implementation.

`useWebRTC.ts` остаётся browser runtime wrapper, но перестаёт менять доменное состояние напрямую.

Он будет:

- управлять `RTCPeerConnection`;
- получать/отдавать `MediaStream`;
- сообщать shared controller о значимых событиях;
- применять mute/camera side effects к tracks на основании domain flags.

## Состояния и переходы

Поддерживаются состояния:

- `idle`
- `ringing`
- `calling`
- `active`

Поддерживаются переходы:

- `idle -> calling`
  при `startOutgoing`
- `idle -> ringing`
  при `receiveIncoming`
- `ringing -> active`
  при `acceptIncoming`
- `calling -> active`
  при `remoteAccepted`
- `ringing -> idle`
  при `rejectIncoming`
- `calling -> idle`
  при `remoteRejected`
- `calling -> idle`
  при `remoteBusy`
- `calling -> idle`
  при `hangUp`
- `active -> idle`
  при `hangUp`
- `active -> idle`
  при `remoteEnded`
- `ringing -> idle`
  при `remoteEnded`

Переходы обязаны:

- очищать `incomingOffer`, когда звонок больше не ожидает accept;
- сохранять `notification` только для `rejected` и `busy` сценариев;
- очищать `notification` по таймеру через controller, а не через reducer;
- не зависеть от существования `MediaStream`.

## Политика mute/camera

`isMuted` и `isCameraOff` являются domain-флагами shared state machine.

Это означает:

- toggle-функции живут в shared;
- применение к `MediaStreamTrack.enabled` живёт в client adapter;
- UI читает флаги из shared snapshot;
- browser runtime подписывается на изменения этих флагов и отражает их на tracks.

## Поток данных

### Входящий signalling

1. WebSocket frame приходит в `useMessengerWS`.
2. Frame routing передаёт call-frame в shared call handler/controller.
3. Controller обновляет shared call session state.
4. Client store применяет snapshot.
5. При необходимости controller делегирует в browser WebRTC runtime.

### Исходящее действие пользователя

1. Пользователь нажимает кнопку звонка или action в overlay.
2. UI вызывает публичный action controller.
3. Controller выполняет transition shared state machine.
4. Controller вызывает browser WebRTC runtime и signalling sender.
5. Client store обновляется snapshot’ом состояния.

### Browser media events

1. `useWebRTC` получает local/remote stream или изменение peer state.
2. Browser adapter обновляет только media refs в client store.
3. Domain-state при этом меняется только через shared transitions.

## Модули

### Shared

- `shared/native-core/calls/call-session.ts`
- `shared/native-core/calls/call-session.test.ts`
- `shared/native-core/calls/call-controller.ts`
- `shared/native-core/calls/call-controller.test.ts`
- уже существующие:
  - `shared/native-core/calls/web/browser-webrtc-runtime.ts`
  - `shared/native-core/calls/web/call-handler-orchestrator.ts`

### Client

- `client/src/store/callStore.ts`
  станет adapter-store
- `client/src/hooks/useCallHandler.ts`
  станет wiring вокруг shared controller
- `client/src/hooks/useWebRTC.ts`
  останется browser runtime adapter
- `client/src/components/CallOverlay/CallOverlay.tsx`
  будет читать разделённые session/media данные
- `client/src/components/ChatWindow/ChatWindow.tsx`
  будет использовать session status без знания внутренних переходов

## Тестирование

Нужно покрыть:

- `idle -> ringing -> active -> idle`
- `idle -> calling -> active -> idle`
- `call_reject` создаёт notification и не оставляет активный call
- `call_busy` создаёт notification и не оставляет активный call
- `toggleMute` и `toggleCamera` меняют только domain flags
- `reset` очищает `incomingOffer`, `callId`, `peerId`, `notification`
- browser adapter применяет mute/camera flags к track’ам без участия reducer

Отдельно должны остаться зелёными текущие тесты:

- `shared-native-core` runtime tests
- `client/src/crypto/*.test.ts`
- `client/src/api/client.test.ts`

## План миграции

1. Добавить `call-session` как чистую shared state machine и покрыть её тестами.
2. Добавить `call-controller`, который публикует snapshot состояния наружу.
3. Переделать `callStore` в store-adapter над shared snapshot plus media refs.
4. Перевести `useCallHandler` на `call-controller`.
5. Оставить `useWebRTC` browser-specific, но убрать из него прямые доменные transition’ы.
6. Обновить `CallOverlay` и `ChatWindow` на чтение нового состояния.
7. Прогнать `vitest` и оба `tsc` конфига для `shared-native-core`.

## Риски

- если смешать domain-state и media refs обратно в одном API, вынос потеряет смысл;
- если notification cleanup останется в UI, появится дублирование и race conditions;
- если `toggleMute` и `toggleCamera` будут менять и shared flags, и tracks в разных местах, состояние может рассинхронизироваться.

## Выбранный вариант

Выбран вариант, в котором:

- shared владеет call state machine целиком;
- client владеет только browser media refs и UI rendering;
- `MediaStream` не выносится в shared;
- Zustand остаётся transport/storage-adapter, а не местом бизнес-логики.
