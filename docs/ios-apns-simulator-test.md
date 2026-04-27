# Тест APNs push-уведомлений в iOS Simulator

## Что работает в симуляторе

| Сценарий | Симулятор | Реальное устройство |
|---|---|---|
| Показ баннера (foreground) | ✅ | ✅ |
| Показ баннера (background) | ✅ | ✅ |
| Deep-link → открытие чата | ✅ | ✅ |
| Реальный APNs токен | ❌ | ✅ |
| Регистрация токена на сервере | ❌ | ✅ |

## Предварительные требования

Выполнить **шаг 2.7** из `docs/remaining-work-plan.md`:

1. Открыть `apps/mobile/ios/Package.swift` в Xcode.
2. Создать App target: имя `Messenger`, bundle ID `com.messenger`.
3. Добавить `Sources/Messenger/` в новый target; `MessengerApp` пометить `@main`.
4. **Signing & Capabilities** → добавить:
   - `Push Notifications`
   - `Background Modes` → `Remote notifications`
5. Назначить entitlements-файл: `apps/mobile/ios/Messenger.entitlements`.

## Отправка тестового push

### 1. Подготовь payload

Файл `apps/mobile/ios/push-test.json` уже создан. Замени `chatId` на реальный id чата из приложения:

```json
{
  "aps": {
    "alert": {
      "title": "Новое сообщение",
      "body": "Тестовое push-уведомление"
    },
    "sound": "default",
    "badge": 1
  },
  "chatId": "REPLACE_WITH_REAL_CHAT_ID"
}
```

Реальный `chatId` можно получить:
- из URL при открытом чате в веб-клиенте
- через `GET /api/chats` (поле `id` в ответе)

### 2. Запусти приложение в симуляторе

Запусти через Xcode → выбери симулятор (iPhone 15, iOS 17+) → Run.

Залогинься и открой нужный чат, чтобы получить его id.

### 3. Отправь push

```bash
# Foreground-тест (приложение на переднем плане)
xcrun simctl push booted com.messenger apps/mobile/ios/push-test.json

# Background-тест (сначала сверни приложение, затем):
xcrun simctl push booted com.messenger apps/mobile/ios/push-test.json
```

Если нужно указать конкретный симулятор (не `booted`):

```bash
# Получить список симуляторов
xcrun simctl list devices | grep Booted

# Отправить по UDID
xcrun simctl push <UDID> com.messenger apps/mobile/ios/push-test.json
```

## Что проверять

### Foreground (приложение открыто)
- [ ] Баннер появляется в верхней части экрана
- [ ] Звук уведомления воспроизводится

### Background (приложение свёрнуто)
- [ ] Уведомление появляется в центре уведомлений
- [ ] Нажатие на уведомление открывает приложение

### Deep-link
- [ ] После нажатия на уведомление открывается именно тот чат, чей `chatId` указан в payload
- [ ] Если приложение было закрыто — после запуска навигация выполняется автоматически

## Как работает deep-link (технически)

1. `AppDelegate.userNotificationCenter(_:didReceive:)` читает `userInfo["chatId"]` и пишет в `AppViewModel.pendingChatId`.
2. `RootView` подписан через `.onChange(of: vm.pendingChatId)` → вызывает `navigateToPendingChat(chatId:)`.
3. Если чаты ещё не загружены — ждёт `.onChange(of: vm.chatStore.chats)` и повторяет попытку.
4. `navPath.append(AppRoute.chat(id:name:))` → открывается `ChatWindowScreen`.

## Ограничение: токен в симуляторе

`didRegisterForRemoteNotificationsWithDeviceToken` в симуляторе либо не вызывается, либо возвращает фиктивный токен. Регистрация токена на сервере (`POST /api/push/native/register`) в этом сценарии не проверяется — это тест только для реального устройства.
