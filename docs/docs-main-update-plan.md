
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
- [ ] Обзор системы (PWA + native apps + self-hosted сервер)
- [ ] Стек технологий (server/client/native/shared)
- [ ] Логические слои и их границы
- [ ] Компонентная диаграмма (схема взаимодействия)
- [ ] Потоки данных: аутентификация, отправка/получение сообщений, звонки 1:1 и групповые (SFU), медиа, vault, linking устройств
- [ ] E2E-модель: X3DH, Double Ratchet, vault-шифрование AES-GCM
- [ ] SFU/звонки: `server/internal/sfu`, `server/internal/calls`, группы
- [ ] Bots API + webhooks
- [ ] Monitoring
- [ ] Native security: biometric lock, privacy screen, update checker
- [ ] Безопасность платформы (JWT, CORS, CSP, proxy trust)
- [ ] Связи с другими доками

### #3 A2 — переработка `technical-documentation.md`

Обязательные разделы:
- [ ] Назначение документа и область применения
- [ ] Server: модули с функциями, зоны ответственности
- [ ] Схема БД: таблицы, индексы, миграции
- [ ] REST API справочник (в паре с `docs/api-reference.md`)
- [ ] WebSocket фреймы (структура + потоки)
- [ ] Client: stores, components, pages, hooks
- [ ] Shared/native-core: API пакетов
- [ ] Native apps: desktop (Compose), android (Compose), ios (SwiftUI) — ключевые экраны и сервисы
- [ ] Crypto-слой: X3DH, Double Ratchet, AES-GCM vault, key storage
- [ ] Конфигурация ENV (полный список)
- [ ] Запуск и тесты
- [ ] Известные ограничения


### #6 C — переработка `usersguid.md`

- [ ] Быстрая установка сервера (Docker)
- [ ] Ручная установка (для разработчиков)
- [ ] Полный список ENV
- [ ] Первый запуск: admin-bootstrap, режимы регистрации
- [ ] Веб-клиент: регистрация, чаты 1:1 и групповые, звонки, голосовые сообщения, галерея медиа, passphrase gate, привязка устройств, профиль
- [ ] Native-приложения (desktop/android/ios): установка, биометрика, privacy screen, обновления
- [ ] Администрирование: панель, инвайты, заявки на регистрацию
- [ ] FAQ / troubleshooting

### #7 D — переработка `deployment.md`

- [ ] Предусловия (Docker, домен, сертификаты)
- [ ] Docker Compose: развёртывание, переменные
- [ ] Dockerfile: multi-stage сборка
- [ ] VAPID keys (persistence)
- [ ] STUN/TURN конфигурация
- [ ] SFU для групповых звонков
- [ ] `BEHIND_PROXY` и reverse-proxy (Cloudflare Tunnel)
- [ ] Bots webhook endpoint
- [ ] Миграции БД: `scripts/db-migrate.sh`, `server/Makefile`
- [ ] Health/monitoring endpoints
- [ ] Ссылки на `docs/release-checklist.md` и `docs/release-tag-instructions.md`
- [ ] Backup/restore SQLite

### #8 Финальная проверка и сводка

- [ ] Согласованность внутренних ссылок между файлами `docs/main/`
- [ ] Соответствие путей фактической структуре
- [ ] Соответствие ENV-переменных коду (`server/cmd/server/config.go`)
- [ ] Обновить `docs/main/next-session.md` с результатами работы (если нужно)
- [ ] Короткий отчёт: что изменилось по каждому файлу, diff-метрики

---

## Журнал сессий

> После каждой сессии добавлять блок: дата, что сделано, что осталось, заметки для следующей сессии.

### Сессия 2026-04-21 — Инициализация плана

- Создан этот файл плана.
- Ничего из чеклиста ещё не выполнено.

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
