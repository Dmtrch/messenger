# ADR: Native Secure Storage

**Статус:** Accepted  
**Дата:** 2026-04-11  
**Контекст:** Foundation для нативных клиентов Messenger

---

## Контекст

Нативные клиенты должны хранить refresh/session state и приватные E2E-материалы вне browser storage. При этом storage должен быть platform-native и не ломать multi-device, offline cache и восстановление сессии после перезапуска.

---

## Решение

Для secure storage фиксируются следующие платформенные адаптеры:

- `iOS`: `Keychain`
- `Android`: `Android Keystore`
- `Desktop`: `OS credential store`

Под `OS credential store` понимается системное хранилище секретов конкретной ОС:

- `macOS`: Keychain
- `Windows`: Credential Manager / DPAPI-backed secure store
- `Linux`: Secret Service; если недоступен, отдельный fallback должен описываться отдельным ADR

---

## Что хранится в secure storage

- refresh token или эквивалентный session secret;
- device identity metadata, если она нужна для session recovery;
- ссылки на локально сохранённые приватные ключи или сами ключи, если конкретная платформа не даёт безопасного key reference API;
- ключи, нужные для шифрования локального профиля, если такой слой будет добавлен позже.

---

## Что не хранится в secure storage

- полная история сообщений;
- media cache;
- полноразмерный outbox/cache;
- обычные UI preferences.

Эти данные остаются в локальной БД или file storage.

---

## Последствия

Плюсы:

- platform-native security model;
- корректное восстановление сессии после рестарта;
- нет зависимости от browser storage semantics.

Минусы:

- потребуется отдельный adapter layer под каждую платформу;
- Linux desktop остаётся самой неоднородной средой.
