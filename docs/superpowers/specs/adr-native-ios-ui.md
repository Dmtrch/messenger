# ADR: Native iOS UI

**Статус:** Accepted  
**Дата:** 2026-04-11  
**Контекст:** Foundation для нативных клиентов Messenger

---

## Контекст

Для iOS нужно было принять решение между двумя направлениями:

- `Compose Multiplatform` UI
- `SwiftUI` поверх shared core

При этом shared business/core слой остаётся общим для нативных клиентов.

---

## Решение

Для iOS фиксируется:

- `KMP shared core`
- `SwiftUI` как основной UI layer

То есть iOS не использует `Compose Multiplatform` как основной UI-стек первого целевого направления.

---

## Причины решения

- `SwiftUI` лучше соответствует native iOS expectations;
- проще интегрировать platform lifecycle, navigation, permissions, background behavior;
- ниже риск компромиссов в UX и системной интеграции на самой дорогой платформе.

---

## Что остаётся общим с другими платформами

- protocol contracts;
- domain model;
- auth/session semantics;
- crypto contracts;
- sync semantics;
- pagination contract.

---

## Последствия

Плюсы:

- iOS остаётся truly-native клиентом;
- проще принимать iOS-specific UI и lifecycle решения;
- меньше риск UX-компромиссов на platform edge cases.

Минусы:

- UI слой не будет общим с Android/Desktop;
- потребуется отдельная iOS UI-команда или отдельная экспертиза.
