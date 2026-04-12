# Apps

Каталог для нативных приложений Messenger.

Структура:

- `desktop/` — desktop-native клиент
- `mobile/android/` — Android-клиент
- `mobile/ios/` — iOS-клиент

Общее правило:

- runtime и UI остаются platform-specific;
- domain/protocol/crypto contracts подтягиваются из `shared/`.
