# Продолжение работы: устранение заглушек в native-клиентах

> **Как пользоваться**: в следующей сессии напиши «продолжаем» — Claude прочитает этот файл и подхватит работу с того места, где остановились.

---

## Текущая задача

Сделать native-клиенты (Desktop / Android / iOS) **рабочими без заглушек**, после чего обновить документацию (`CLAUDE.md`, README native-клиентов, `docs/prd-alignment-progress.md`) — убрать формулировки «foundation / not production-ready».

Выбран вариант **B**: сначала чиним код, потом обновляем документацию. Не наоборот.

---

## Что уже сделано в предыдущих сессиях

1. **`docker-compose.yml`** — добавлен `env_file: .env`, порт сделан параметризуемым (`${PORT:-8080}:${PORT:-8080}`), оставлена валидация `JWT_SECRET`, фиксированы пути `DB_PATH`/`MEDIA_DIR` внутри контейнера.
2. **`install-server.md`** — исправлен режим регистрации: `request` → `approval` (сервер валидирует `open|invite|approval`).
3. **`install-server.sh` / `install-server.bat`** — исправлены в предыдущих итерациях.
4. **`docs/install-client.md`** — создан подробный гайд по установке клиента (Web PWA / Desktop / Android / iOS) для Windows / macOS / Linux.
5. **Проведён аудит заглушек** в `apps/desktop/`, `apps/mobile/android/`, `apps/mobile/ios/` (результаты ниже).

---

## Результаты аудита: что именно чинить

### Desktop (Kotlin Compose)

| # | Файл:строка | Проблема |
|---|-------------|----------|
| 1 | `apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt:204,226` | `getOrElse { "stub-sdp" }` — при ошибке WebRTC SDP отправляется строка-заглушка, звонок ломается |
| 2 | `apps/desktop/src/main/kotlin/ui/screens/BiometricGateScreen.kt:14` | macOS Touch ID через JNA + LAContext не реализован (опционально) |
| 3 | `apps/desktop/src/main/kotlin/store/ChatStore.kt:50` | typing-индикатор не сбрасывается по таймеру |

### Android (Kotlin Compose)

| # | Файл:строка | Проблема |
|---|-------------|----------|
| 4 | `apps/mobile/android/src/main/kotlin/com/messenger/crypto/SessionManager.kt:141` | `Fallback: plain base64 text (stub payload)` — сообщение уходит незашифрованным при отсутствии сессии |
| 5 | `apps/mobile/android/src/main/kotlin/com/messenger/push/FcmService.kt` | сервис FCM полностью заглушен: нет отправки токена на сервер (строка 17), нет показа уведомления в фоне (строка 21) |

### iOS (SwiftUI)

| # | Файл:строка | Проблема |
|---|-------------|----------|
| 6 | `apps/mobile/ios/Sources/Messenger/viewmodel/AppViewModel.swift:235` | при отправке медиа не прикрепляются `mediaId`/`mediaKey` к сообщению |
| 7 | `apps/mobile/ios/Sources/Messenger/viewmodel/AppViewModel.swift:493` | ошибки `changePassword` не прокидываются в UI |
| 8 | `apps/mobile/ios/Sources/Messenger/ui/screens/ProfileScreen.swift:133` | `ApiClient.changePassword` — TODO Step B+ |

### Расхождения с PWA (отдельный вопрос)

В native-клиентах **нет** экранов, которые есть в PWA:
- `AdminPage`
- `DownloadsPage`
- `LinkDevicePage`

Также `docs/prd-alignment-progress.md` пункт **P2-LOC-2 (Native SQLCipher)** помечен `skipped` с обоснованием «не в production scope».

---

## Предлагаемая декомпозиция (по приоритету)

| # | Задача | Платформа | Сложность |
|---|--------|-----------|-----------|
| 1 | Убрать `stub-sdp` в WebRTC — прокидывать ошибку в UI, не начинать звонок | Desktop | S |
| 2 | Убрать `plain base64` fallback — отказывать в отправке без сессии | Android | S |
| 3 | Typing-таймер auto-reset | Desktop | S |
| 4 | iOS: ошибки `changePassword` в UI | iOS | S |
| 5 | iOS: attach `mediaId`/`mediaKey` к сообщению перед отправкой | iOS | M |
| 6 | iOS: реализовать `ApiClient.changePassword` | iOS | M |
| 7 | Android FCM: регистрация токена + показ уведомления | Android | M (нужен `google-services.json` или сделать опциональным) |
| 8 | macOS Touch ID через JNA | Desktop | L (опционально) |
| 9 | Портировать `AdminPage` / `DownloadsPage` / `LinkDevicePage` в native | все | L (отдельный этап) |
| 10 | Обновить `CLAUDE.md`, README native-клиентов, `prd-alignment-progress.md` — убрать «foundation / not production-ready» | docs | S |

---

## Вопросы, на которые ждём ответ от пользователя

Перед стартом кода нужно решить:

1. **Порядок работ.** Идём по таблице сверху вниз или режем что-то из scope (#8 Touch ID, #9 недостающие экраны)?
2. **Android FCM (#7).** Реализовать полноценно (требует `google-services.json` и Firebase-проект) или оставить опциональным — Web Push уже работает, мобилка может без FCM? Во втором варианте #7 = «убрать слово stub из комментариев + задокументировать, что FCM не обязателен для MVP».
3. **#9 недостающие экраны** (Admin / Downloads / LinkDevice). Включаем в этот заход или выносим в отдельную фазу P3?
4. **#10 обновление docs** — делаем в самом конце, после всех фиксов. Подтверждаешь?

---

## Как продолжить в следующей сессии

1. Открой эту сессию Claude Code в том же каталоге (`/Users/dim/vscodeproject/messenger`).
2. Напиши **«продолжаем»** или **«продолжаем работу по docs/continue-session.md»**.
3. Ответь на 4 вопроса выше — Claude начнёт с задачи #1.

Если передумаешь и захочешь другую последовательность — просто скажи новый порядок задач из таблицы.
