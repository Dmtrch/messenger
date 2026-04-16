# Next Session

## Статус

Desktop Этап 2 завершён. E2E шифрование подключено на всех трёх платформах (Android, iOS, Desktop).
Единственный оставшийся баг — iOS OPK: `initAsResponder` считает 3-DH вместо 4-DH, OPK private keys не сохраняются под server-assigned ID.

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

## Следующие задачи

### iOS OPK fix — дополнить `initAsResponder` до 4-DH

**Контекст.**
Android и Desktop при инициации X3DH включают `opkId` в wire-payload и считают общий секрет через 4-DH (`dh1+dh2+dh3+dh4`). iOS-responder (`SessionManager.swift:initAsResponder`) делает только 3-DH и игнорирует `opkId` — из-за этого вычисляется другой `sharedSecret` и первое входящее сообщение от Android/Desktop не расшифровывается.

**Перед началом проверить:**
- `apps/mobile/ios/Sources/Messenger/crypto/SessionManager.swift` — строка с `TODO: OPK`
- `apps/mobile/ios/Sources/Messenger/service/ApiClient.swift` — сигнатура `registerKeys`, возвращает ли `RegisterKeysResponse`
- `apps/mobile/ios/Sources/Messenger/crypto/KeyStorage.swift` — как хранятся OPK (сейчас `opk_list`, нужно добавить `opk_{id}`)
- `apps/mobile/ios/Sources/Messenger/viewmodel/AppViewModel.swift` — `registerKeysIfNeeded`, сохраняет ли server-assigned OPK IDs

**Файлы для изменения:**

1. `ApiClient.swift`
   - Добавить `struct RegisterKeysResponse: Decodable { let deviceId: String; let opkIds: [Int] }`
   - Изменить `func registerKeys(_ req:)` → возвращает `RegisterKeysResponse`

2. `KeyStorage.swift`
   - Добавить `func saveOneTimePreKeySecret(_ secret: Bytes, id: Int)` — сохраняет в Keychain под ключом `"opk_\(id)"`
   - Добавить `func loadOneTimePreKeySecret(id: Int) -> Bytes?` — читает `"opk_\(id)"`

3. `SessionManager.swift` — `initAsResponder`
   - Добавить `dh4`: если `wire.opkId != nil`, загрузить `keyStorage.loadOneTimePreKeySecret(id: wire.opkId!)` и вычислить `dh4 = scalarmult(opkPriv, aliceEKPub)`
   - Включить `dh4` в `combined`: `dh1 + dh2 + dh3 + dh4`
   - Удалить `TODO`-комментарий

4. `AppViewModel.swift` — `registerKeysIfNeeded`
   - Получить `RegisterKeysResponse` из `client.registerKeys(req)`
   - Сохранить каждый OPK private key: `regResp.opkIds.enumerated().forEach { keyStorage.saveOneTimePreKeySecret(opks[$0.offset].secretKey, id: $0.element) }`

**Эталон:** Android реализация — `AppViewModel.kt` строки 356-360, `SessionManager.kt` строки 269-274.

**Проверка после изменений:**
- `swift test` в `apps/mobile/ios/` — все существующие тесты должны пройти
- Добавить тест `SessionManagerOPKTest` (аналог `SessionManagerTest.kt` для Desktop): Alice (iOS) → Bob (iOS) с `opkId`, убедиться что 4-DH даёт одинаковый секрет у обеих сторон
