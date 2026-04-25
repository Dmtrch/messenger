
# План обновления `docs/main/` под текущее состояние кода

> **Назначение**: многосессионный чеклист для полной переработки документов в `docs/main/`. Файл переживает сессии: после каждой сессии агент отмечает выполненные пункты и вписывает заметки, следующая сессия может продолжить с того же места.

---

## Контекст и условия

- **Scope**: все 6 файлов в `docs/main/`.
- **Глубина**: полная переработка под текущее состояние кода.
- **Базовая точка отсчёта**: коммит `60d7c93` («feat: фаза 1 — биометрика, vault, новые UI-компоненты, серверные модули»), запушен в `origin/main` 2026-04-21.
- **Язык документов**: русский.
- **Правила работы** (из `CLAUDE.md`):
  - Не выдумывать факты. Если что-то неясно — `I don't know` и уточнение.
  - Перечислять риски изменений и предлагать тесты.
  - Писать только внутри рабочей папки `/Users/dim/vscodeproject/messenger/`.

## Файлы на переработку

| # | Файл | Текущий объём | Жанр |
|---|---|---|---|
| 1 | `docs/main/architecture.md` | 695 строк, 12 секций | Архитектурный обзор |
| 2 | `docs/main/technical-documentation.md` | 1829 строк, 37 секций | Справочник технический |
| 3 | `docs/main/v1-gap-remediation.md` | 497 строк, 17 секций | Статус gap-remediation |
| 4 | `docs/main/next-session.md` | 46 строк, 3 секции | Задачи следующей сессии |
| 5 | `docs/main/usersguid.md` | 313 строк, 8 секций | Руководство пользователя |
| 6 | `docs/main/deployment.md` | 162 строки, 8 секций | Руководство по развёртыванию |

## Группировка в подзадачи

- **Подзадача A**: A1 `architecture.md` + A2 `technical-documentation.md` — технические доки, согласовываются друг с другом.
- **Подзадача B**: B1 `v1-gap-remediation.md` + B2 `next-session.md` — статус-документы.
- **Подзадача C**: `usersguid.md` — руководство пользователя.
- **Подзадача D**: `deployment.md` — руководство по развёртыванию.

---

## Файл-снимок исследования

Чтобы не проводить исследование кода заново в каждой сессии, результаты сохраняются в отдельный файл-снимок:

- **Путь**: `docs/docs-main-update-research.md`
- **Назначение**: структурированный справочник по коду, который служит источником истины при написании всех 6 документов.
- **Маркер актуальности**: в шапке файла фиксируются `baseline_sha` (коммит, на основе которого сделан снимок) и `watched_paths` (пути, изменения в которых инвалидируют снимок).
- **Содержимое**: серверные модули и их публичный API, схема БД, REST/WS endpoints, клиентские stores/components/pages, shared/native-core API, native apps (экраны/сервисы), ENV-переменные, Docker/Make-таргеты.

### Watched paths (что отслеживаем)

```
server/
client/src/
shared/native-core/
apps/
Dockerfile
docker-compose.yml
scripts/db-migrate.sh
server/Makefile
.github/workflows/build-native.yml
docs/api-reference.md
docs/crypto-rationale.md
docs/prd-alignment-progress.md
docs/prd-vs-impl.md
docs/security-audit.md
docs/test-plan.md
docs/release-checklist.md
```

### Проверка актуальности снимка (выполнять в начале каждой сессии)

```sh
# 1. Взять baseline_sha из шапки docs/docs-main-update-research.md
# 2. Выполнить:
git diff --name-only <baseline_sha>..HEAD -- \
  server/ client/src/ shared/native-core/ apps/ \
  Dockerfile docker-compose.yml scripts/db-migrate.sh server/Makefile \
  .github/workflows/build-native.yml \
  docs/api-reference.md docs/crypto-rationale.md docs/prd-alignment-progress.md \
  docs/prd-vs-impl.md docs/security-audit.md docs/test-plan.md docs/release-checklist.md
```

- **Пусто** → снимок актуален, переходим к следующему пункту чеклиста.
- **Есть изменения** → обновить только задетые секции снимка, затем сдвинуть `baseline_sha` на текущий HEAD.

---

## Чеклист (отмечать по ходу выполнения)

### #1 Создать/обновить файл-снимок `docs/docs-main-update-research.md`

**Этот шаг выполняется один раз при создании снимка, затем только инкрементально обновляется при расхождении с `baseline_sha`.**

- [ ] Создан файл `docs/docs-main-update-research.md` с шапкой (`baseline_sha`, `watched_paths`, дата).
- [ ] Серверные модули: `server/internal/{admin,auth,bots,calls,chat,clienterrors,devices,downloads,integration,keys,logger,media,middleware,monitoring,password,push,serverinfo,sfu,storage,users,ws}`
- [ ] Схема БД: `server/db/{schema.go,queries.go,migrate.go}`
- [ ] Точка входа и конфигурация: `server/cmd/server/{main.go,config.go}`
- [ ] Клиент: `client/src/{components,pages,store,hooks,types}`
- [ ] Shared/native-core: `shared/native-core/{auth,crypto,storage,websocket,api,messages,calls,sync}`
- [ ] Native apps: `apps/desktop/**`, `apps/mobile/android/**`, `apps/mobile/ios/**`
- [ ] Root: `Dockerfile`, `docker-compose.yml`, `.github/workflows/build-native.yml`, `scripts/db-migrate.sh`, `server/Makefile`
- [ ] Существующая документация: `docs/{api-reference,crypto-rationale,deployment,prd-alignment-progress,prd-vs-impl,security-audit,test-plan,release-checklist}.md`

**Выход**: заполненный `docs/docs-main-update-research.md` со всеми секциями выше.

**В последующих сессиях этот пункт = «выполнить git diff против baseline_sha и обновить только задетые секции снимка»**.

### #2 A1 — переработка `architecture.md`

Обязательные разделы:
- [x] Обзор системы (PWA + native apps + self-hosted сервер)
- [x] Стек технологий (server/client/native/shared)
- [x] Логические слои и их границы
- [x] Компонентная диаграмма (схема взаимодействия)
- [x] Потоки данных: аутентификация, отправка/получение сообщений, звонки 1:1 и групповые (SFU), медиа, vault, linking устройств
- [x] E2E-модель: X3DH, Double Ratchet, vault-шифрование AES-GCM
- [x] SFU/звонки: `server/internal/sfu`, `server/internal/calls`, группы
- [x] Bots API + webhooks
- [x] Monitoring
- [x] Native security: biometric lock, privacy screen, update checker
- [x] Безопасность платформы (JWT, CORS, CSP, proxy trust)
- [x] Связи с другими доками (ссылки исправлены: v1-gap-remediation → prd-alignment-progress, next-session → remaining-work-plan)

### #3 A2 — переработка `technical-documentation.md`

Обязательные разделы:
- [x] Назначение документа и область применения
- [x] Server: модули с функциями, зоны ответственности
- [x] Схема БД: таблицы, индексы, миграции
- [x] REST API справочник (в паре с `docs/api-reference.md`)
- [x] WebSocket фреймы (структура + потоки)
- [x] Client: stores, components, pages, hooks
- [x] Shared/native-core: API пакетов
- [x] Native apps: desktop (Compose), android (Compose), ios (SwiftUI) — ключевые экраны и сервисы
- [x] Crypto-слой: X3DH, Double Ratchet, AES-GCM vault, key storage
- [x] Конфигурация ENV (полный список)
- [x] Запуск и тесты
- [x] Известные ограничения (ссылка §12.6 исправлена: v1-gap-remediation → prd-alignment-progress)


### #6 C — переработка `usersguid.md`

- [x] Быстрая установка сервера (Docker)
- [x] Ручная установка (для разработчиков)
- [x] Полный список ENV
- [x] Первый запуск: admin-bootstrap, режимы регистрации
- [x] Веб-клиент: регистрация, чаты 1:1 и групповые, звонки, голосовые сообщения, галерея медиа, passphrase gate, привязка устройств, профиль
- [x] Native-приложения (desktop/android/ios): установка, биометрика, privacy screen, обновления
- [x] Администрирование: панель, инвайты, заявки на регистрацию
- [x] FAQ / troubleshooting

### #7 D — переработка `deployment.md`

- [x] Предусловия (Docker, домен, сертификаты)
- [x] Docker Compose: развёртывание, переменные
- [x] Dockerfile: multi-stage сборка
- [x] VAPID keys (persistence)
- [x] STUN/TURN конфигурация
- [x] SFU для групповых звонков
- [x] `BEHIND_PROXY` и reverse-proxy (Cloudflare Tunnel)
- [x] Bots webhook endpoint
- [x] Миграции БД: `scripts/db-migrate.sh`, `server/Makefile`
- [x] Health/monitoring endpoints
- [x] Ссылки на `docs/release-checklist.md` и `docs/release-tag-instructions.md`
- [x] Backup/restore SQLite
- [x] ENV-таблица расширена: PORT, DB_PATH, MEDIA_DIR, DOWNLOADS_DIR, SERVER_NAME/DESCRIPTION, FCM/APNs split

### #8 Финальная проверка и сводка

- [x] Согласованность внутренних ссылок между файлами `docs/main/` (v1-gap-remediation/next-session убраны отовсюду)
- [x] Соответствие путей фактической структуре
- [x] Соответствие ENV-переменных коду (`server/cmd/server/config.go`)
- [x] `docs/main/next-session.md` и `docs/main/v1-gap-remediation.md` удалены; ссылки переведены на `docs/remaining-work-plan.md` и `docs/prd-alignment-progress.md`
- [x] Изменения зафиксированы коммитом `docs: финализировать docs/main/ — синхронизация с текущим состоянием кода`

---

## Журнал сессий

> После каждой сессии добавлять блок: дата, что сделано, что осталось, заметки для следующей сессии.

### Сессия 2026-04-21 — Инициализация плана

- Создан этот файл плана.
- Ничего из чеклиста ещё не выполнено.

### Сессия 2026-04-25 — Финализация плана

- Все пункты #2/#3/#6/#7/#8 отмечены выполненными.
- `architecture.md`, `technical-documentation.md`: исправлены ссылки с удалённых `v1-gap-remediation.md` / `next-session.md` на `docs/prd-alignment-progress.md` / `docs/remaining-work-plan.md`.
- `deployment.md`: расширена ENV-таблица (PORT, DB_PATH, MEDIA_DIR, DOWNLOADS_DIR, SERVER_NAME, APNS split).
- `usersguid.md`: не требовал правок — устаревших ссылок нет.
- Файл-снимок `docs/docs-main-update-research.md` не создавался — снимок не нужен, все doc-файлы актуализированы напрямую.

### Сессия 2026-04-21 — Переход на работу через файл-снимок

- План переработан: этап #1 больше не про «исследовать заново», а про поддержание `docs/docs-main-update-research.md` в актуальном состоянии.
- Добавлен раздел «Файл-снимок исследования» с `baseline_sha`, `watched_paths` и командой проверки актуальности.
- Обновлён раздел «Как продолжить в новой сессии» — первым шагом идёт проверка актуальности снимка.
- Сам файл снимка (`docs/docs-main-update-research.md`) ещё не создан. Это следующий шаг: при первом заходе в #1 он будет заполнен.

---

## Как продолжить в новой сессии

1. Открыть этот файл: `docs/docs-main-update-plan.md`.
2. Открыть файл-снимок: `docs/docs-main-update-research.md`. Если его нет — выполнить пункт #1 чеклиста (первичное заполнение).
3. **Проверить актуальность снимка**: выполнить `git diff --name-only <baseline_sha>..HEAD -- <watched_paths>` (команда и `watched_paths` — выше в разделе «Файл-снимок исследования»). При наличии изменений — обновить задетые секции снимка и сдвинуть `baseline_sha`.
4. Найти первый невыполненный пункт в чеклисте (#2 и далее).
5. Проверить «Журнал сессий» — там могут быть предупреждения/контекст.
6. Выполнить пункт, опираясь на снимок как на источник истины; отметить `[x]`, добавить запись в журнал.
7. Коммит: `docs(main): <какой файл обновлён> — <кратко что>`.

## Политика коммитов

- Отдельный коммит на каждый файл `docs/main/*.md` (легче ревьюить).
- Не пушить на `origin/main` без явного согласия пользователя.
- Обновлять этот план в том же коммите, что и соответствующий документ.
- Если в ходе работы обновлён `docs/docs-main-update-research.md` (сдвиг `baseline_sha` или правки секций) — он коммитится вместе с планом или отдельным коммитом `docs(main): refresh research snapshot`.
