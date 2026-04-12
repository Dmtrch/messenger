# ADR: Native Crypto Stack

**Статус:** Accepted  
**Дата:** 2026-04-11  
**Контекст:** Foundation для нативных клиентов Messenger

---

## Контекст

В проекте уже реализован рабочий клиентский crypto stack в `client/src/crypto/`:

- `X3DH`
- `Double Ratchet`
- `skipped message keys`
- `Sender Keys`
- multi-device session semantics
- совместимый message payload format

Нативные клиенты должны быть криптографически совместимы с текущим PWA и сервером. Менять crypto model на этапе Foundation нельзя.

---

## Решение

Зафиксировано следующее:

1. Каноническая криптографическая модель остаётся той же, что уже реализована в PWA.
2. Базовый примитивный слой для нативных клиентов должен оставаться в семействе `libsodium`, а не заменяться на другой crypto stack.
3. Каноничными являются:
   - алгоритмы;
   - device/session semantics;
   - wire-format;
   - test vectors.

Нативные клиенты реализуют platform bindings к этой же модели, а не новую модель шифрования.

---

## Platform guidance

- `Desktop`: нативный binding к `libsodium`
- `Android`: нативный binding к `libsodium`
- `iOS`: нативный binding к `libsodium`

Конкретные обёртки и packaging choices могут различаться по платформам, но они не должны менять:

- формат ключей;
- derivation flow;
- ciphertext envelope;
- session storage contract;
- sender key behavior.

---

## Что переносится без изменений

- логика `X3DH` bootstrap;
- логика `Double Ratchet`;
- логика `Sender Keys`;
- device-scoped session model;
- cross-device fan-out semantics;
- защита от out-of-order через skipped keys.

---

## Что считается недопустимым

- переход на другой protocol family ради platform convenience;
- разные ciphertext formats на разных клиентах;
- platform-specific fork логики ratchet или sender keys;
- несовместимые тестовые векторы.

---

## Последствия

Плюсы:

- сохраняется совместимость с уже реализованным PWA;
- меньше риск protocol drift;
- можно строить единый набор cross-platform test vectors.

Минусы:

- перенос crypto в нативные рантаймы будет требовать аккуратной compatibility-верификации;
- часть удобных platform-native crypto API нельзя будет использовать как полную замену модели.
