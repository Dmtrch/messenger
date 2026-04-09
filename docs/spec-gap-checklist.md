# Чеклист закрытия разрывов со спецификацией

Источник: [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md)

## Must

- [ ] Ввести полноценную multi-device модель
- [ ] Реализовать `POST /api/keys/register`
- [x] Реализовать Sender Keys для групп
- [x] Добавить skipped message keys в Double Ratchet
- [x] Реализовать encrypted media at rest
- [x] Защитить `GET /api/media/:id` через JWT
- [x] Перейти с `filename` на `mediaId`
- [ ] Довести delivery/read receipts до полного realtime-цикла
- [ ] Реализовать offline history viewing
- [x] Сделать TLS обязательным в production
- [x] Перевести refresh cookie на `SameSite=Strict`
- [x] Зафиксировать bcrypt cost = 12
- [x] Добавить rate limiting для auth endpoints
- [x] Добавить security headers

## Should

- [ ] Добавить смену пароля с инвалидцией всех сессий
- [ ] Перейти на пагинацию истории по `messageId` или opaque cursor
- [ ] Реализовать серверные `unreadCount`, `updatedAt`, `lastMessage`
- [ ] Довести lifecycle `prekey_request`
- [ ] Добавить полноценный offline sync слой поверх IndexedDB
- [x] Ограничить `CheckOrigin` для WebSocket
- [ ] Ввести конфигурационный файл сервера
- [ ] Перейти на versioned migrations и целевую схему БД
- [ ] Добавить backend tests
- [ ] Добавить frontend tests

## Could

- [ ] Подготовить проверенный deployment guide для Cloudflare Tunnel
- [ ] Описать и автоматизировать update path без потери данных
- [ ] Встроить обязательную синхронизацию документации в процесс разработки

## Контрольные вехи

- [ ] Закрыты все `Must`
- [ ] Закрыты все security-пункты из спецификации
- [ ] Закрыты все data-model и migration-пункты
- [ ] Закрыты все crypto-пункты
- [ ] Закрыты все test-пункты
