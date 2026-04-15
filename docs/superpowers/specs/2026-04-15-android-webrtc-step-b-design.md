# Android WebRTC Step B Design

Дата: 2026-04-15
Статус: draft for review
Область: `apps/mobile/android`

## Цель

Перевести Android call stack со Step A stub signaling на реальный WebRTC media path:
- исходящий и входящий видеозвонок сразу поднимают камеру и микрофон;
- offer/answer используют реальный SDP от `org.webrtc`;
- ICE кандидаты передаются через текущий WebSocket signaling;
- `CallOverlay` показывает минимальный `SurfaceViewRenderer` для remote video и локального preview;
- Desktop остаётся на stub и не получает media implementation.

## Границы

Включено:
- Android dependency на `org.webrtc:google-webrtc`;
- Android-only controller для `PeerConnectionFactory`, `PeerConnection`, local tracks, renderer lifecycle;
- расширение call signaling для SDP и `ice_candidate`;
- минимальная интеграция Compose UI для `SurfaceViewRenderer`.

Не включено:
- mute/unmute;
- camera toggle;
- screen share;
- Desktop media;
- iOS media;
- TURN/STUN orchestration beyond existing `/api/calls/ice-servers`.

## Подход

Рекомендуемый вариант: отдельный `AndroidWebRtcController`, а не встраивание WebRTC логики в `AppViewModel`.

Причины:
- Android-specific media lifecycle не должен жить внутри `ViewModel`;
- проще локализовать зависимости на `org.webrtc`;
- проще тестировать signaling отдельно от media;
- Desktop можно оставить без изменений, кроме совместимости формата signaling frames.

## Архитектура

### 1. `AndroidWebRtcController`

Новый Android-only слой отвечает за:
- инициализацию `PeerConnectionFactory`;
- создание `PeerConnection` с ICE servers из `ApiClient.getIceServers()`;
- создание local audio/video tracks и local stream;
- attach local tracks к peer connection;
- создание offer/answer;
- приём remote SDP;
- сбор и публикацию локальных ICE кандидатов;
- lifecycle `SurfaceTextureHelper`, camera capturer, `EglBase`, `SurfaceViewRenderer`.

Контроллер не знает про Compose navigation и не хранит UI state кроме ссылок на renderer lifecycle.

### 2. `AppViewModel`

`AppViewModel` остаётся orchestration-layer:
- инициирует вызов;
- принимает входящий вызов;
- отправляет signaling frames в WS;
- получает callbacks от `AndroidWebRtcController` для `offer`, `answer`, `ice_candidate`;
- завершает/очищает сессию при `hangUp`, `rejectCall`, `call_end`.

`AppViewModel` не создаёт SDP вручную и не управляет camera APIs напрямую.

### 3. `WSOrchestrator`

Новые обязанности:
- принимать `call_offer` с реальным `sdp`;
- принимать `call_answer` с реальным `sdp`;
- принимать `ice_candidate`;
- пробрасывать их в `AppViewModel`/controller bridge.

Текущие `call_end` и `call_reject` сохраняются без изменения semantics.

### 4. `CallState` и UI state

`CallState` расширяется только данными верхнего уровня:
- `status`;
- `callId`;
- `chatId`;
- `remoteUserId`;
- `isVideo`;
- флаг доступности remote video;
- флаг доступности local preview.

Сами `PeerConnection`, capturer и renderer references в `CallState` не кладём.

## Signaling Flow

### Outgoing video call

1. Пользователь нажимает кнопку вызова.
2. `AppViewModel.initiateCall(...)` переводит store в `RINGING_OUT`.
3. `AndroidWebRtcController.startOutgoingCall(...)`:
- создаёт factory/peer connection;
- поднимает камеру и микрофон;
- создаёт local tracks;
- создаёт offer SDP;
- возвращает SDP callback-ом.
4. `AppViewModel` отправляет `call_offer`:
- `callId`
- `chatId`
- `targetId`
- `sdp`
- `isVideo`
5. По мере генерации локальных ICE отправляются `ice_candidate`.
6. Когда приходит `call_answer`, controller применяет remote description.
7. После первого успешного media establishment store переходит в `ACTIVE`.

### Incoming video call

1. `WSOrchestrator` получает `call_offer` с `sdp`.
2. Store переводится в `RINGING_IN`.
3. При `acceptCall()`:
- controller создаёт peer connection;
- поднимает камеру и микрофон;
- применяет remote offer;
- создаёт answer SDP;
- возвращает SDP callback-ом.
4. `AppViewModel` отправляет `call_answer`.
5. Далее стороны обмениваются `ice_candidate`.

### End / reject

- `call_reject` не стартует media;
- `call_end` и локальный `hangUp()` закрывают peer connection, capturer, renderer bindings и сбрасывают store в `IDLE`.

## UI / Renderer Design

`CallOverlay.kt` получает Android-only composable wrapper над `SurfaceViewRenderer`:
- remote renderer занимает основной контейнер;
- local preview рендерится маленьким floating inset;
- если remote track ещё не пришёл, показывается текстовый placeholder поверх тёмного фона;
- для audio-only режимов renderer container не показывается.

Renderer lifecycle:
- `remember` для holder-объекта;
- `DisposableEffect` для `init`/`release`;
- связывание renderer с controller происходит только пока overlay видим.

## Error Handling

Если WebRTC init или camera capture падает:
- логируем ошибку;
- завершаем текущую call session;
- возвращаем store в `IDLE`;
- overlay показывает краткую ошибку только в рамках текущей сессии, без глобального state machinery.

Если ICE/SDP frame приходит для другого `callId`, он игнорируется.

Если пользователь отклоняет/завершает звонок раньше завершения offer/answer:
- outgoing async callbacks должны проверять актуальный `callId`;
- устаревшие callbacks не должны повторно активировать state.

## Тестовая стратегия

Перед основной реализацией добавить тесты на signaling behavior:
- `WSOrchestrator` корректно читает `call_offer.sdp`;
- `WSOrchestrator` корректно читает `call_answer.sdp`;
- `WSOrchestrator` корректно читает `ice_candidate`;
- `AppViewModel` отправляет `call_offer` и `call_answer` уже с реальным payload contract, а не `stub-sdp`.

Unit-тесты не должны поднимать реальный `org.webrtc`. Для этого signaling contract и callbacks держим отдельно от concrete WebRTC implementation.

Ручная проверка после реализации:
1. Android `assembleDebug`.
2. Android unit tests.
3. Исходящий Android→Android видеозвонок: local preview появился сразу.
4. После answer появился remote video.
5. Hang up очищает overlay и не оставляет активную камеру.

## Изменяемые зоны

Ожидаемые файлы:
- `apps/mobile/android/build.gradle.kts`
- `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`
- `apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt`
- `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`
- `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/CallOverlay.kt`
- новые Android-only WebRTC файлы рядом с service/ui слоями

Desktop и shared runtime не меняем, кроме случая, если потребуется безопасно расширить JSON contract без изменения поведения.
