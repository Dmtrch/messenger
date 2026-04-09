# Задачи на следующую сессию

Актуально на: 2026-04-09. Ветка: `main`.

---

## Приоритет 1 — Must (блокирует закрытие плана)

### 1.1 lastMessage в ChatSummary не расшифровывается
**Файл:** `client/src/pages/ChatListPage.tsx`, `client/src/components/ChatList/ChatList.tsx`  
**Проблема:** сервер возвращает `lastMessageText` как зашифрованный payload; список чатов отображает ciphertext вместо превью текста.  
**Что сделать:**
- При загрузке чатов (`getChats`) пробовать расшифровать `lastMessageText` для каждого чата через `decryptMessage` / `decryptGroupMessage` из `session.ts`
- Если расшифровка не удалась (нет сессии) — показывать placeholder «Зашифрованное сообщение»
- Для медиасообщений — показывать «📎 Вложение»

---

## Приоритет 2 — Should (качество и надёжность)

### 2.1 Смена пароля с инвалидацией всех сессий
**Файлы:** `server/internal/auth/handler.go`, `server/db/queries.go`, клиент — новый экран  
**Что сделать:**
- Backend: `POST /api/auth/change-password` (требует текущий пароль + новый + JWT)
  - обновить `password_hash`
  - удалить все `sessions` пользователя кроме текущей
  - опционально — закрыть все WS-соединения пользователя через Hub
- Frontend: экран смены пароля в `ProfilePage`; forced re-login после смены

### 2.2 prekey_low — добавить backoff на клиенте
**Файл:** `client/src/hooks/useMessengerWS.ts` (`replenishPreKeys`)  
**Проблема:** при каждом WS-подключении может прийти `prekey_low` → повторная загрузка 20 ключей; при нестабильной сети создаёт дублирующие запросы.  
**Что сделать:**
- Хранить timestamp последнего пополнения в `keystore.ts` (или `localStorage`)
- Блокировать повторный `replenishPreKeys` в течение ~5 минут

### 2.3 Skipped keys — добавить TTL
**Файл:** `client/src/crypto/ratchet.ts`  
**Проблема:** `skippedKeys` растёт без очистки; при долгих сессиях накапливается до MAX_SKIP=100 без автоматического удаления старых.  
**Что сделать:**
- Добавить `storedAt: number` (timestamp) в каждый `skippedKey`
- При сериализации в IndexedDB и при decrypt — удалять ключи старше 7 дней
- Обновить тип `SkippedKey` в `ratchet.ts`

---

## Приоритет 3 — Тесты (этап 8)

### 3.1 Backend tests
**Что нужно покрыть минимально:**
- `auth`: refresh rotation, invalid JWT, expired token, duplicate username
- `keys`: register idempotency, PopPreKey by device, bundle 404 if no keys
- `chat`: forbidden access (non-member), delete/edit authorization
- `db`: RunMigrations idempotent, migration #7 table recreation
- `ws`: message delivery, typing broadcast, read receipt

**Инструменты:** `go test ./...`, временная SQLite in-memory (`?mode=memory`), `net/http/httptest`

### 3.2 Frontend tests
**Что нужно покрыть минимально:**
- `ratchet.ts`: out-of-order decrypt, skipped keys, MAX_SKIP limit
- `session.ts`: E2E encrypt/decrypt round-trip, group SKDM
- `x3dh.ts`: initiator/responder handshake
- `api/client.ts`: auto-refresh on 401, failed refresh → logout

**Инструменты:** Vitest + `@testing-library/react`, `fake-indexeddb` для IDB моков

---

## Приоритет 4 — Could

### 4.1 Конфигурационный файл сервера
**Что сделать:** поддержать `config.yaml` рядом с бинарником; env-переменные переопределяют файл; defaults берутся из файла если env не задан. Библиотека: `gopkg.in/yaml.v3` или `github.com/spf13/viper`.

### 4.2 Sender Key ротация при смене состава группы
**Файл:** `client/src/crypto/session.ts`, `client/src/crypto/senderkey.ts`  
**Проблема:** при добавлении/удалении участника SenderKey не пересоздаётся → новый участник может расшифровать прошлые сообщения.  
**Что сделать:**
- При создании чата или изменении состава — удалять `my_sender_key:{chatId}` из keystore
- При следующей отправке в группу lazy-инициализация создаст новый SenderKey и разошлёт SKDM текущим участникам

### 4.3 Групповые звонки (LiveKit SFU)
Требует отдельного Docker-сервиса. Отложено до запроса. См. `docs/v1-gap-remediation.md` этап 9.

---

## Контекст для быстрого старта

```
git log --oneline -6
```

Последние коммиты этой сессии:
- `43d39f1` docs: синхронизировать документацию с текущим состоянием кода
- `a444a5f` docs: отметить долг #5 (PopPreKey device_id) как закрытым
- `95eb73d` docs: отметить долг #6 (RegisterDevice идемпотентность) как закрытым
- `51126a0` fix(keys): RegisterDevice идемпотентен по IK public key
- `9b4f35b` fix(keys): PopPreKey и CountFreePreKeys фильтруют по device_id
- `0f59098` fix(db): composite PK (user_id, device_id) для identity_keys

Ключевые файлы, изменённые в сессии:
- `server/db/migrate.go` — Migration struct + Steps, migration #7
- `server/db/schema.go` — identity_keys composite PK для свежих установок
- `server/db/queries.go` — UpsertIdentityKey, PopPreKey, CountFreePreKeys, GetIdentityKeyByIKPublic
- `server/internal/keys/handler.go` — RegisterDevice (идемпотентность), GetBundle (device_id)
- `server/internal/ws/hub.go` — CountFreePreKeys с deviceID=""
