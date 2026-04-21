# Privacy Screen Contract

## Назначение

Скрывать контент приложения в системном switcher задач и при захвате экрана. Реализуется на трёх платформах с разными механизмами, единым флагом настройки.

## Флаг настройки

| Поле | Тип | Умолч. | Хранение |
|---|---|---|---|
| `privacyScreenEnabled` | Boolean | `false` | SharedPrefs / UserDefaults / java.prefs |

## Сценарии защиты

| Сценарий | Android | iOS | Desktop |
|---|---|---|---|
| App switcher / Recent Apps | FLAG_SECURE → серая карточка | Blur overlay при `.inactive`/`.background` | Overlay при потере фокуса окна |
| Screen recording / Capture | FLAG_SECURE блокирует | `UIScreen.capturedDidChangeNotification` | Не поддерживается |
| OS screenshot hotkey | FLAG_SECURE блокирует | Не блокируется | Не блокируется |
| Foreground / активное использование | Флаг снят | Overlay скрыт | Overlay скрыт |

## Исключения

- Экраны биометрики/PIN (`BiometricGateScreen`, `BiometricGateView`) — privacy overlay всё равно применяется поверх (это защита снапшота, не контент).
- Экран настройки сервера (ServerSetupScreen) — не содержит чувствительный контент, overlay уместен.

## Lifecycle hooks

### Android
- `onCreate`: считать флаг из PrivacyScreenStore, применить `window.setFlags(FLAG_SECURE)` / `clearFlags`
- `lifecycleScope.launch { PrivacyScreenStore.enabled.collect { ... } }` — динамическая реакция

### iOS
- `@Environment(\.scenePhase)` в RootView: `.inactive`/`.background` → `isObscured = true`, `.active` → `false`
- `UIScreen.capturedDidChangeNotification` → `isObscured = UIScreen.main.isCaptured`
- ZStack overlay: `if privacyScreenEnabled && isObscured { BlurOverlayView() }`

### Desktop
- `LocalWindowInfo.current.isWindowFocused` в App composable
- `if privacyEnabled && !isWindowFocused { PrivacyOverlay() }`

## Настройки UI

Секция `PrivacyScreenSection` в ProfileScreen на всех трёх платформах — после секции `AppLockSection`.

## Платформенные ограничения

- **Desktop**: нет аналога FLAG_SECURE; OS screenshot hotkeys (Cmd+Shift+3/4, PrintScreen) не блокируются
- **iOS**: screen recording можно обнаружить через `UIScreen.isCaptured`, но не заблокировать
- **Android**: FLAG_SECURE полностью блокирует скриншоты и запись экрана внутри приложения
