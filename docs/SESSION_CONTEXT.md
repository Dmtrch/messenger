# Контекст сессии — Messenger Project

## Статус проекта

Архитектор завершил базовую документацию. Проект в стадии проектирования.

## Выполненные задачи

- [x] Архитектурный документ: `docs/architecture.md`
  - Стек технологий (Go + SQLite + React PWA)
  - Схема E2E шифрования (X3DH + Double Ratchet)
  - API контракт (REST + WebSocket)
  - Схема БД
  - Сравнение 3 архитектурных подходов с рекомендацией
- [x] Спецификация: `docs/superpowers/specs/messenger-spec.md`
  - Функциональные требования с приоритетами
  - Нефункциональные требования
  - Полный API (JSON примеры)
  - DDL схемы БД
  - Конфигурация сервера
  - Roadmap v1.0 → v2.0

## Следующие шаги (не выполнены)

### Архитектор
- [ ] Завершить дизайн системы по секциям (остановились на Секции 1):
  - Секция 2 — Поток отправки/доставки сообщения (E2E + ACK)
  - Секция 3 — Мультидевайс и синхронизация ключей
  - Секция 4 — Push-уведомления (оффлайн)
  - Секция 5 — Медиафайлы (загрузка/скачивание)
- [ ] ADR (Architecture Decision Records) для ключевых решений

### Backend (Go)
- [ ] Инициализация Go модуля: `server/`
- [ ] Схема БД: `server/db/schema.sql`
- [ ] Auth service (register, login, refresh, logout)
- [ ] Keys service (X3DH публичные ключи)
- [ ] WebSocket Hub
- [ ] Messages API
- [ ] Media upload/download
- [ ] Push (VAPID)
- [ ] TLS + конфигурация

### Frontend (React PWA)
- [ ] Инициализация Vite + React + TypeScript: `client/`
- [ ] PWA манифест + Service Worker
- [ ] Crypto layer (X3DH, Double Ratchet, libsodium)
- [ ] IndexedDB keystore
- [ ] UI: Auth (login/register)
- [ ] UI: Chat list
- [ ] UI: Chat view + отправка сообщений
- [ ] WebSocket клиент
- [ ] Push подписка

## Команда

- **architect** — архитектор (текущий агент)
- **frontend** — frontend разработчик (React PWA)
- **backend** — backend разработчик (Go)
- **team-lead** — руководитель команды

## Как продолжить

Напишите **"продолжаем"** — архитектор продолжит работу с Секции 2 дизайна системы и координации команды.

## Ключевые файлы

| Файл | Описание |
|---|---|
| `docs/architecture.md` | Полная архитектура системы |
| `docs/superpowers/specs/messenger-spec.md` | Техническая спецификация |
| `docs/SESSION_CONTEXT.md` | Этот файл — контекст сессии |
