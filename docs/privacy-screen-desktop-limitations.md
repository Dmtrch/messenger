# Privacy Screen — Desktop Limitations

## Реализованное

- При потере фокуса окна (клик в другое приложение, Alt+Tab/Cmd+Tab) — контент перекрывается тёмным overlay.
- При сворачивании окна — overlay активен, контент скрыт.
- Флаг `privacyScreenEnabled` хранится в `java.util.prefs.Preferences`, переживает перезапуск.

## Ограничения по платформам

### macOS
- `Cmd+Shift+3` / `Cmd+Shift+4` (скриншот области) — **не блокируются**. Нет публичного API для этого в Compose Desktop.
- Mission Control показывает превью окна — Compose Desktop не предоставляет API для masking в Mission Control.
- При потере фокуса overlay срабатывает через `LocalWindowInfo.current.isWindowFocused`.

### Windows
- `PrintScreen` / `Win+PrintScreen` — **не блокируются**. `SetWindowDisplayAffinity(WDA_MONITOR)` (аналог FLAG_SECURE) требует JNA/JNI, не реализован.
- Task View (Win+Tab) показывает превью — не блокируется.
- Alt+Tab показывает превью — не блокируется.

### Linux
- Screenshot hotkeys (зависят от WM) — **не блокируются**.
- Overlay при потере фокуса работает через Compose Desktop window focus API.

## Возможные улучшения (не в текущем scope)

- **Windows**: JNA вызов `SetWindowDisplayAffinity(hwnd, WDA_MONITOR)` — аналог FLAG_SECURE, полная защита.
- **macOS**: нет публичного API уровня FLAG_SECURE. Возможна JNI-интеграция с Cocoa `NSWindow.sharingType = .none` для защиты screen sharing, но не скриншотов.
- **Все платформы**: overlay при сворачивании/Mission Control через platform-specific window events.
