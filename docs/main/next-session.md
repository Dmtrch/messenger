# Next Session

## Статус

Desktop и Android: Этап 2 завершён. E2E шифрование (SessionManager) реализовано. Добавлен интерфейс поиска и создания чатов.
iOS: Этап 2 завершён. Исправлен транспорт (WebSocket + Outbox) и реализован 4-DH (OPK fix). Добавлен интерфейс поиска и создания чатов. Все платформы теперь совместимы по E2E-протоколу и набору базовых функций.

## Закрытые проблемы (справочно)

| # | Проблема | Статус |
|---|----------|--------|
| 1 | remote-server flow — login/push через относительные пути, нет HTTP CORS | ✅ |
| 2 | approval-registration — ключи не переносились при approve | ✅ |
| 3 | WS recipient injection — не проверялось членство получателей | ✅ |
| 4 | user directory / key discovery — политика принята, OPK-pop исправлен | ✅ |
| 5 | media upload — произвольный `chat_id` без проверки членства | ✅ |
| 6 | `typing` без проверки членства отправителя | ✅ |
| 7 | server test suite — `Role` не передавался в helper'ах, race в WS-тестах | ✅ |
| 8 | Регрессионные тесты A–D (admin/ws/media/keys) | ✅ |
| 9 | iOS тест-векторы (X3DHVectorTests, RatchetVectorTests) | ✅ |
| 10 | Android Этап 1 — SessionManager + ApiClient.getKeyBundle + WSOrchestrator + AppViewModel | ✅ |
| 11 | Android OPK fix — сервер возвращает opkIds, клиент сохраняет приватные части, initAsResponder использует dh4 | ✅ |
| 12 | Desktop Этап 2 — SessionManager + ApiClient.getKeyBundle + WSOrchestrator + AppViewModel (real E2E) | ✅ |
| 13 | E2E bootstrap JVM-тест — X3DH handshake, bidirectional, out-of-order (skip keys), group SKDM | ✅ |
| 14 | iOS: Унификация транспорта (WebSocket + Outbox) и интеграция SessionManager | ✅ |
| 15 | iOS: OPK fix (4-DH в initAsResponder) и сохранение ключей по ID | ✅ |
| 16 | Native Clients: Реализация UI поиска пользователей и создания чатов (Android, Desktop, iOS) | ✅ |

## Следующие задачи (Roadmap)

### 1. [Medium] WebRTC Stability — Video Calls

**Проблема:** `CallOverlay` на мобильных платформах работает нестабильно, требует отладки WebRTC-сигнализации и рендеринга видео-фреймов.

### 2. [Low] Безопасность (Encrypted Storage)

**Проблема:** Ключи и токены хранятся в открытом виде (`UserDefaults`, `SharedPreferences`).
**Задачи:**
- Android: Переход на `EncryptedSharedPreferences`.
- iOS: Полный перенос ключей в `Keychain` (начато: OPK уже в Keychain, нужно перенести Identity/Signed PreKey).
- Desktop: Шифрование `keystore`.

**Проверка после изменений:**
- `swift test` в `apps/mobile/ios/` (успешно)
- Кросс-платформенные тесты: Android <-> iOS E2E сообщение и создание чата.
- Поиск пользователей работает на всех платформах.
