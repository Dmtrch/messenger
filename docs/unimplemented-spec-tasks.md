# Нереализованные задачи по `docs/superpowers/specs/messenger-spec.md`

Этот файл фиксирует требования из [`docs/superpowers/specs/messenger-spec.md`](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/messenger-spec.md), которые на текущий момент не реализованы полностью или требуют дополнительной проверки.

---

## ✅ Реализованные задачи (из Must/Should)

- **AUTH-1..5 (Аутентификация)**: Регистрация, логин (JWT + Refresh), httpOnly cookie, Logout, Multi-device (регистрация нескольких устройств).
- **AUTH-6 (Смена пароля)**: `UpdateUserPassword` + `DeleteUserSessionsExcept` — реализовано в `server/internal/auth/handler.go:218-228`.
- **MSG-1..4, 11 (Сообщения)**: Текст, группы, оффлайн-доставка, статусы (Delivered/Read), пагинация.
- **MEDIA-1, 6 (Медиа)**: Загрузка изображений, шифрование медиа на клиенте (E2E at rest).
- **E2E-1..5 (Шифрование)**: X3DH, Double Ratchet (включая skipped keys), Sender Keys (группы), хранение в IndexedDB.
- **PWA-1..4 (PWA/Offline)**: Установка, оффлайн-просмотр истории, очередь отправки (outbox), Service Worker.
- **SEC (Безопасность)**: TLS policy, bcrypt (cost 12), Rate limiting, Security headers, JWT-защита медиа.
- **Аудио/видео звонки 1-на-1 (WebRTC, PWA)**: Полностью реализованы в PWA — сигнализация (`Hub.go`), ICE-серверы с HMAC-кредами (`calls.go`), state machine (`call-controller.ts`), WebRTC runtime (`browser-webrtc-runtime.ts`), UI (`CallOverlay.tsx`).

---

## ⚠️ Частично реализованные или требующие проверки

### 1. Автоматическое удаление медиа (MEDIA-7)
**Приоритет**: `Should`
**Статус**: ⚠️ Баг подтверждён. `DeleteMessages()` (`db/queries.go:413`) делает только `is_deleted=1` в таблице `messages` — файл на диске и запись в `media_objects` **не удаляются**. Фоновый `cleanOrphans` удаляет только файлы без привязки к чату, но удалённое сообщение сохраняет привязку к `media_objects`, поэтому такой файл не попадает под очистку. Нужно либо при `DeleteMessages` вызывать `os.Remove` + удаление из `media_objects`, либо расширить логику `cleanOrphans` на `is_deleted=1`.

### 2. Индикатор присутствия (MSG-6)
**Приоритет**: `Should`
**Статус**: ⚠️ `Hub` отслеживает `IsOnline`, но события смены статуса (`presence`) не рассылаются всем контактам автоматически.

---

## ❌ Нереализованные задачи (Backlog)

### 1. Верификация идентичности (Safety Number / QR) (E2E-6)
**Приоритет**: `Should`
**Описание**: Возможность сравнить отпечатки Identity Key (Safety Numbers) между двумя пользователями для защиты от MITM.
**Методика**: На клиенте добавить экран "Safety Number" с отображением хеша IK собеседника.

### 2. Предупреждение при смене ключей (E2E-7)
**Приоритет**: `Should`
**Описание**: Если пользователь переустановил приложение (новый IK), собеседник должен получить уведомление "Identity of Alice has changed".
**Методика**: На клиенте при получении нового bundle от `GET /api/keys/:userId` сравнивать с сохранённым и выводить системное сообщение в чат.

### 3. Ответ на сообщение (Reply) (MSG-9)
**Приоритет**: `Should`
**Описание**: Визуальная привязка сообщения к предыдущему.
**Методика**: Добавить `replyToId` в payload сообщения.

### 4. Групповые звонки (SFU)
**Приоритет**: `Could`
**Описание**: Использование LiveKit или аналогичного SFU для групп > 3 человек.

---

## Нативные приложения (apps/) — отсутствующий функционал

Нативные приложения (`apps/desktop`, `apps/mobile/android`) являются базовым каркасом. Умеют: авторизация, список чатов, текстовые сообщения через WebSocket, базовый E2E (X3DH/Ratchet).

### 1. Звонки в нативных приложениях
**Статус**: ❌ Не реализованы.
В `ChatWindowScreen.kt` (Desktop и Android) нет кнопок вызова. В `ApiClient.kt` нет обращений к `/api/calls/ice-servers`. Нет интеграции нативных WebRTC-библиотек (Google WebRTC для Android, JNA-обёртки для Desktop).

### 2. Передача файлов в нативных приложениях
**Статус**: ❌ Не реализована.
В `ChatWindowScreen.kt` нет кнопки выбора файлов. В `ApiClient.kt` нет методов для `multipart/form-data` загрузки и клиентского шифрования медиа (в отличие от PWA, где реализованы `uploadEncryptedMedia` / `fetchEncryptedMediaBlobUrl`).

---

## Технический долг и тесты

- **Тесты Backend**: Покрыть тестами `RegisterDevice` (идемпотентность), `GetBundle` (multi-device), `DeliverToDevice`.
- **Тесты Frontend**: Покрыть тестами `Ratchet` (логика skipped keys) и `SenderKey`.
- **Конфигурационный файл**: Перенести все `env` параметры в `config.yaml` как основной способ настройки (частично сделано в `server/cmd/server/config.go`).
