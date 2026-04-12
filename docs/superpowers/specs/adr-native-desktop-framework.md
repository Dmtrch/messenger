# ADR: Native Desktop Framework

**Статус:** Accepted  
**Дата:** 2026-04-11  
**Контекст:** Foundation для нативных клиентов Messenger

---

## Контекст

Desktop-клиент должен быть полноценным нативным приложением для:

- `Windows`
- `Linux`
- `macOS`

При этом он не должен быть thin wrapper над текущим PWA-клиентом.

---

## Решение

Для desktop family фиксируется:

- `Kotlin Multiplatform`
- `Compose Multiplatform Desktop`

Это решение считается каноническим для этапов `Desktop Native` и `Shared Core`.

---

## Почему не Electron

- desktop app остаётся web-runtime centered;
- архитектурно это слишком близко к текущему PWA;
- не решает задачу native-first семейства клиентов.

## Почему не Tauri

- Tauri легче Electron, но остаётся web UI shell;
- это хорошо для desktop packaging, но не для выбранной архитектурной линии проекта;
- решение хуже согласуется с общим shared core направлением.

---

## Последствия

Плюсы:

- единый desktop runtime;
- нативный lifecycle;
- лучшее согласование с Android/shared core направлением.

Минусы:

- выше порог входа, чем у Electron/Tauri;
- потребуется отдельная platform integration работа для tray, notifications, deep links, packaging.
