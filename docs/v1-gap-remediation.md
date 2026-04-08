# План закрытия разрывов со спецификацией

## Цель

Закрыть критичные расхождения между текущей реализацией и [`docs/superpowers/specs/messenger-spec.md`](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/messenger-spec.md) без хаотичных изменений в архитектуре.

## Принципы плана

- сначала безопасность и контракт API;
- затем данные и миграции;
- затем криптография и групповые сценарии;
- затем offline/PWA;
- затем тесты и эксплуатация.

## Этап 1. Безопасность и серверный perimeter

### Цель этапа

Сделать текущий backend безопаснее без ломки клиентского UX.

### Задачи

1. Ввести обязательный production TLS policy.
2. Добавить security middleware:
   - CSP
   - HSTS
   - X-Frame-Options
   - X-Content-Type-Options
3. Добавить rate limiting на auth endpoints.
4. Перевести refresh cookie на `SameSite=Strict`.
5. Явно зафиксировать bcrypt cost = 12.
6. Ограничить `CheckOrigin` для WebSocket.

### Выход этапа

- backend соответствует минимальным security-требованиям спецификации;
- снижен риск эксплуатации публичного инстанса в небезопасной конфигурации.

## Этап 2. Media access и media model

### Цель этапа

Перевести медиа из текущей MVP-модели в модель, совместимую со спецификацией.

### Задачи

1. Ввести `mediaId`.
2. Добавить таблицу `media_objects`.
3. Перевести `GET /api/media/:id` под JWT.
4. Реализовать проверку доступа к медиа по участию в чате.
5. Подготовить клиент к работе через authenticated fetch или signed URLs.

### Выход этапа

- медиа перестают быть публичными файлами по случайному имени;
- API начинает соответствовать ожидаемому контракту.

## Этап 3. Device model и key registration

### Цель этапа

Перестроить ключевую модель под устройства, а не только под пользователя.

### Задачи

1. Добавить `devices`.
2. Вынести `identity_keys` и `one_time_prekeys` на уровень устройства.
3. Реализовать `POST /api/keys/register`.
4. Обновить `GET /api/keys/:userId` на возврат bundle по устройствам.
5. Изменить клиентское хранение session state.

### Выход этапа

- появляется фундамент для реального multi-device;
- ключевой API становится совместим со спецификацией.

## Этап 4. Message state и список чатов

### Цель этапа

Стабилизировать серверную модель чатов и статусов.

### Задачи

1. Реализовать серверные `unreadCount`, `updatedAt`, `lastMessage`.
2. Перевести пагинацию на `messageId` или opaque cursor.
3. Завершить delivery/read receipt flow.
4. Ввести `chat_user_state` или эквивалентный слой.

### Выход этапа

- список чатов становится server-driven;
- история сообщений и статусы перестают зависеть от локальных догадок клиента.

## Этап 5. Криптографическая доработка

### Цель этапа

Закрыть основные разрывы между текущим E2E MVP и целевой криптографической схемой.

### Задачи

1. Добавить skipped message keys.
2. Реализовать lifecycle `prekey_request`.
3. Реализовать Sender Keys для групп.
4. Реализовать encrypted media at rest:
   - client-side encryption media;
   - server-side ciphertext-only storage;
   - local decrypt on download.

### Выход этапа

- E2E-модель покрывает и out-of-order доставку, и группы, и медиа.

## Этап 6. Offline/PWA слой

### Цель этапа

Довести PWA до реального offline сценария, а не только до installable shell.

### Задачи

1. Добавить IndexedDB persistence для истории.
2. Добавить offline sync queue.
3. Реализовать background resend для исходящих сообщений.
4. Обновить Service Worker стратегию.
5. Добавить UI-индикацию offline состояния.

### Выход этапа

- приложение соответствует требованиям offline history viewing;
- пользовательский сценарий в нестабильной сети становится предсказуемым.

## Этап 7. Migration framework и эксплуатация

### Цель этапа

Подготовить проект к эволюции схемы и обновлениям.

### Задачи

1. Ввести versioned migrations.
2. Отказаться от runtime `ALTER TABLE` без журнала.
3. Описать update path.
4. Подготовить deployment guide:
   - TLS
   - Cloudflare Tunnel
   - backup/restore

### Выход этапа

- проект можно обновлять без ручной реконструкции БД;
- deployment становится воспроизводимым.

## Этап 8. Тестовый контур

### Цель этапа

Зафиксировать критичные сценарии автоматическими тестами.

### Задачи

1. Backend tests:
   - auth
   - keys
   - chat
   - ws
   - db
2. Frontend tests:
   - crypto
   - api client
   - ключевые UI-компоненты
3. Добавить smoke-check для совместимости client/server.

### Выход этапа

- критичные изменения перестают быть blind refactor;
- можно безопаснее двигать security и crypto контур.

## Рекомендуемый порядок выполнения

1. Этап 1
2. Этап 2
3. Этап 3
4. Этап 4
5. Этап 5
6. Этап 6
7. Этап 7
8. Этап 8

## Критерий завершения

План считается закрытым, когда:

- все пункты `Must` из [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md) выполнены;
- чеклист в [`docs/spec-gap-checklist.md`](/Users/dim/vscodeproject/messenger/docs/spec-gap-checklist.md) закрыт по разделу `Must`;
- документация синхронизирована с новым состоянием кода.
