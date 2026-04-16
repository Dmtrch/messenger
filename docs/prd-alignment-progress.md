# Прогресс PRD alignment

Источник задач: `docs/prd-alignment-plan.md`.
Обновлять строку статуса при старте/завершении задачи; дату ставить в формате `YYYY-MM-DD`.

Статусы: `pending` · `in_progress` · `blocked` · `done` · `skipped`.

## Фаза 0. Подготовка

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| F0-1 | Бейзлайн и метрики (зелёные билды, CHANGELOG, progress doc) | done | 2026-04-17 | См. `prd-alignment-baseline.md`. Бейзлайн полностью зелёный после шага 0.5. |
| F0-1.5 | Подготовительный фикс компиляции desktop/android (`NewChatScreen.kt`, `ApiClient.kt`) | done | 2026-04-17 | Desktop assemble ✅, Android assembleDebug ✅. Детали — в baseline doc. |
| F0-2 | Контрольные тест-векторы (invites, Argon2id, SQLCipher) | done | 2026-04-17 | См. `shared/test-vectors/invites.json`, `argon2id.json`, `sqlcipher.json`. Эталонные данные — placeholder до реализации P1-PWD-1 / P1-INV-1 / P2-LOC. |

## Фаза 1 (P1). Gatekeeping и криптография сервера

### 1.1 Инвайты

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-INV-1 | Жёсткий TTL=180с для инвайтов | pending | — | — |
| P1-INV-2 | QR-код в админке | pending | — | — |
| P1-INV-3 | Аннулирование инвайта (DELETE /api/admin/invite-codes/{id}) | pending | — | — |
| P1-INV-4 | Журнал активаций (IP, UA) | pending | — | — |
| P1-INV-5 | Визуальный таймер обратного отсчёта в админке | pending | — | — |

### 1.2 Пароли Argon2id

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-PWD-1 | Модуль `password` с Argon2id (PHC-string) | pending | — | — |
| P1-PWD-2 | Lazy-миграция с bcrypt | pending | — | — |
| P1-PWD-3 | Rate-limit + constant-time compare | pending | — | — |

### 1.3 TLS 1.3

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-TLS-1 | Принудительный `MinVersion: tls.VersionTLS13` | pending | — | — |

### 1.4 Дистрибуция нативных бинарей

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-DIST-1 | CI-сборка артефактов (exe/dmg/deb/apk/ipa) + подпись | pending | — | — |
| P1-DIST-2 | Защищённая зона `/api/downloads/*` с manifest | pending | — | — |
| P1-DIST-3 | Страница `/downloads` + авто-OS + редирект после регистрации | pending | — | — |
| P1-DIST-4 | Auto-config (встроенный `server_url`) при сборке дистрибутива | pending | — | — |

### 1.5 Kill Switch / Suspend / Remote Wipe

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-SEC-1 | Статусы аккаунтов (`active/suspended/banned`) + middleware | pending | — | — |
| P1-SEC-2 | Revoke all sessions (session_epoch) | pending | — | — |
| P1-SEC-3 | Remote Wipe (WS-фрейм + очистка локального хранилища) | pending | — | — |
| P1-SEC-4 | UI админки: Suspend/Ban/Kill Switch | pending | — | — |

## Фаза 2 (P2). UX приватности и multi-device

### 2.1 Исчезающие сообщения

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-EPH-1 | Схема и API (messages.expires_at, default_ttl, endpoints) | pending | — | — |
| P2-EPH-2 | Фоновый уборщик + WS `message_expired` | pending | — | — |
| P2-EPH-3 | Клиент: таймер, UI TTL, локальное удаление | pending | — | — |

### 2.2 Multi-device QR pairing

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-MD-1 | Протокол device-linking (доки + endpoints) | pending | — | — |
| P2-MD-2 | Клиенты: desktop QR, mobile scanner, E2E-передача Ratchet | pending | — | — |
| P2-MD-3 | Re-keying при удалении устройства | pending | — | — |
| P2-MD-4 | UI управления устройствами в Settings | pending | — | — |

### 2.3 Локальное шифрование клиента

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-LOC-1 | PWA passphrase/WebAuthn PRF + wrap idb-keyval | pending | — | — |
| P2-LOC-2 | Native SQLCipher (Android/iOS/Desktop) + OS-keystore | pending | — | — |
| P2-LOC-3 | Encrypted media blobs + zeroing out | pending | — | — |

### 2.4 Privacy Tools нативных

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-NAT-1 | Биометрия/PIN на запуск | pending | — | — |
| P2-NAT-2 | Запрет скриншотов (FLAG_SECURE/iOS dimming) | pending | — | — |

## Фаза 3 (P3). Масштабирование и расширения

### 3.1 Групповые звонки

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-CALL-1 | SFU (pion) + расширенный сигналинг | pending | — | — |
| P3-CALL-2 | Grid UI + мьют/pin | pending | — | — |

### 3.2 Админ-возможности

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-ADM-1 | Дисковые квоты | pending | — | — |
| P3-ADM-2 | Retention для медиа | pending | — | — |
| P3-ADM-3 | Мониторинг CPU/RAM/диск (gopsutil + recharts) | pending | — | — |
| P3-ADM-4 | Роль «модератор» | pending | — | — |
| P3-ADM-5 | Лимит участников группы | pending | — | — |
| P3-ADM-6 | Флаг `ALLOW_USERS_CREATE_GROUPS` | pending | — | — |

### 3.3 Local Bot API

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-BOT-1 | Модель + API (bots/tokens/webhooks) | pending | — | — |
| P3-BOT-2 | Security hardening (rotate, rate-limit, локальные webhook) | pending | — | — |

### 3.4 Auto-update клиентов

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UPD-1 | Манифест версий (shared с P1-DIST-2) | pending | — | — |
| P3-UPD-2 | Апдейтеры Desktop/Android/iOS | pending | — | — |

### 3.5 UX-пробелы

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UX-1 | Встроенная медиа-галерея | pending | — | — |
| P3-UX-2 | Voice-notes UI (запись, waveform) | pending | — | — |
| P3-UX-3 | Лимит размера загрузки (`MAX_UPLOAD_BYTES`) | pending | — | — |
| P3-UX-4 | Документ `crypto-rationale.md` + AES-GCM обёртка | pending | — | — |

## Фаза 4. Валидация и выпуск

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| V-1 | Тест-план (unit + Playwright E2E) | pending | — | — |
| V-2 | Security review + govulncheck/npm audit/trivy | pending | — | — |
| V-3 | Обновление документации (README, docs, PRD-vs-impl) | pending | — | — |
| V-4 | Скрипт миграций БД (`server/db/migrate.go`) | pending | — | — |
| V-5 | Релиз 1.0-PNM (сборка и публикация бинарей) | pending | — | — |

---

## Правила ведения

1. При старте задачи: `pending → in_progress` + проставить дату.
2. При блокере: `in_progress → blocked` + причина в «Примечании».
3. При завершении: `in_progress → done` + дата + ссылки на PR/коммиты в «Примечании».
4. Если задача отменяется: `skipped` + причина.
5. Изменения в прогрессе и самом плане идут одним PR с изменением кода; разрыв не допускается.
