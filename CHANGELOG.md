# Changelog

Формат следует принципам [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Версионирование — [SemVer](https://semver.org/lang/ru/).

## [1.0.0] — 2026-04-21

### Added
- Invite system: жёсткий TTL=180с, QR-коды, аннулирование, журнал активаций, live-таймер обратного отсчёта.
- Пароли Argon2id (PHC-string, NFC-нормализация, lazy-миграция с bcrypt без сброса паролей).
- Rate limiting для auth-эндпоинтов (20 req/min) и bot-эндпоинтов (60 req/min).
- Принудительный TLS 1.3 на сервере.
- CI-сборка нативных бинарей (DMG / DEB / MSI / APK) с подписью артефактов.
- Защищённая зона `/api/downloads/*` с manifest и проверкой SHA256.
- Страница загрузок `/downloads` с автодетектом OS и прямыми ссылками.
- Auto-config SERVER_URL при сборке дистрибутива (bake-in через build-скрипт).
- Статусы аккаунтов (active / suspended / banned) и middleware принудительной проверки.
- Revoke all sessions (session_epoch) — Kill Switch для компрометированного аккаунта.
- Remote Wipe через WebSocket: команда сервера полностью очищает данные клиента.
- Admin UI: Suspend / Ban / Kill Switch / Remote Wipe / управление ролями пользователей.
- Исчезающие сообщения: configurable TTL per chat, автоочистка на сервере, WS-нотификации, countdown UI.
- Multi-device QR pairing: device-link токены, activate flow, управление привязанными устройствами.
- Локальное шифрование хранилища: PBKDF2+AES-256-GCM vault, PassphraseGate, смена пароля.
- Шифрование медиафайлов в IndexedDB + zeroing-out буферов после использования.
- Биометрия / PIN на запуск нативных приложений (Android / iOS / Desktop).
- Запрет скриншотов: FLAG_SECURE (Android), screen dimming (iOS), блокировка Window Capture (Desktop).
- SFU для групповых звонков (pion/webrtc): Grid UI, VAD, динамическое управление потоками.
- Дисковые квоты пользователей с проверкой при загрузке медиафайлов.
- Retention-политика для медиафайлов: автоудаление по истечении срока хранения.
- Мониторинг CPU / RAM / диск сервера (gopsutil + recharts + SSE-стриминг).
- Роль «модератор» с ограниченными правами в Admin UI.
- Лимит участников группы и флаг `ALLOW_USERS_CREATE_GROUPS` в конфиге.
- Local Bot API с webhooks и HMAC-SHA256 подписью запросов + SSRF-защита.
- Auto-update клиентов: Desktop (Squirrel / deb), Android (in-app update), iOS (App Store prompt).
- Медиа-галерея с lightbox-просмотром и постраничной загрузкой.
- Voice notes: запись аудио в браузере + waveform-визуализация.
- Лимит размера загрузки `MAX_UPLOAD_BYTES` (конфигурируемый).
- Документы PRD alignment: план, прогресс, бейзлайн, тест-векторы (`docs/`, `shared/test-vectors/`).

### Changed
- `client/package.json`: версия `0.1.0` → `1.0.0`.
- `apps/mobile/android/build.gradle.kts`: appVersion default `"1.0"` → `"1.0.0"`.
- `apps/mobile/ios/Sources/Messenger/BuildConfig.swift`: добавлена константа `appVersion`.

### Fixed
- Восстановлена компиляция `apps/desktop` и `apps/mobile/android` после рефакторинга: замена несуществующего параметра `disabled` на `enabled` в `NewChatScreen.kt`; добавлен отсутствующий `import` в `ApiClient.kt`.
- Lazy-миграция bcrypt → Argon2id: существующие пароли не требуют сброса — повторное хеширование при следующем успешном входе.

### Security
- Argon2id хеширование паролей с PHC-string и NFC-нормализацией Unicode.
- Принудительный TLS 1.3 (TLS 1.0/1.1/1.2 отключены).
- Rate limiting: auth (20 req/min), bots (60 req/min) — защита от брутфорса.
- Constant-time сравнение паролей (`subtle.ConstantTimeCompare`) — защита от timing-атак.
- HMAC-SHA256 подпись webhook-запросов к Bot API.
- Блокировка локальных и приватных адресов в webhook URL (SSRF protection).
- Шифрование локального хранилища AES-256-GCM с PBKDF2-ключом.
- Remote Wipe: полная очистка localStorage + IndexedDB по команде сервера.
- Kill Switch: одномоментный отзыв всех активных сессий пользователя.

---

## [0.x] — baseline

Исторические релизы до старта PRD alignment — см. git-историю.

[1.0.0]: https://github.com/Dmtrch/messenger/releases/tag/v1.0.0
