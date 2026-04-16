# Changelog

Формат следует принципам [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased] — PRD alignment

Работы по приведению кодовой базы к `prd.md` (Private Node Messenger).
Детальный план: `docs/prd-alignment-plan.md`.
Прогресс: `docs/prd-alignment-progress.md`.
Бейзлайн билдов: `docs/prd-alignment-baseline.md`.

### Added
- План приведения проекта к PRD (`docs/prd-alignment-plan.md`).
- Отчёт расхождений реализации и PRD (`docs/prd-vs-implementation.md`).
- Контрольные тест-векторы для инвайтов, Argon2id и SQLCipher (`shared/test-vectors/`).
- Документы прогресса и бейзлайна фазы PRD alignment.

### Changed
- (в работе) Переход на Argon2id для хеширования паролей (P1-PWD).
- (в работе) Инвайты с жёстким TTL=180с, QR и журналом активаций (P1-INV).

### Fixed
- Восстановлена компиляция `apps/desktop` и `apps/mobile/android` перед стартом PRD-alignment: в `NewChatScreen.kt` заменён несуществующий параметр `disabled` на `enabled`; в `apps/desktop/.../service/ApiClient.kt` добавлен `import io.ktor.client.request.parameter`.

### Security
- (в работе) Принудительный TLS 1.3 на сервере (P1-TLS-1).
- (в работе) Kill Switch / Suspend / Remote Wipe (P1-SEC).

---

## [0.x] — baseline

Исторические релизы до старта PRD alignment — см. git-историю.
