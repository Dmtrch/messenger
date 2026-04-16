# Shared Test Vectors

Каталог для кроссплатформенных test vectors.

Назначение:

- проверка совместимости web и native клиентов;
- проверка одинаковой сериализации payload;
- проверка корректности `X3DH`, `Double Ratchet`, `Sender Keys`;
- проверка multi-device и cursor-based сценариев там, где это требует фиксированных входов и выходов;
- закрепление контрактов безопасности из `docs/prd-alignment-plan.md` (инвайты, пароли, локальное хранилище).

## Каталоги манифестов

- `manifest.json` — канонический каталог **крипто**-векторов (X3DH, Double Ratchet, Sender Key). Стабилен и жёстко связан с `contracts.test.mjs`.
- `security-manifest.json` — каталог векторов **безопасности/приватности** из PRD alignment (инвайты, Argon2id, SQLCipher).

## Векторы PRD alignment (`security-manifest.json`)

| Файл | Suite | Связанные задачи | Примечание |
|---|---|---|---|
| `invites.json` | `invites` | P1-INV-1…5 | TTL=180с, revoke, single-use, журнал активаций, QR-формат. |
| `argon2id.json` | `password` | P1-PWD-1…3 | Параметры `m=65536,t=3,p=4`, PHC-string. Эталонные хеши проставить после реализации `server/internal/password`. |
| `sqlcipher.json` | `local-storage` | P2-LOC-1…3 | Параметры SQLCipher для Android/iOS/Desktop + PWA-аналог на libsodium. |

## Запуск проверок

```bash
# Контракт-тесты (ДОЛЖНЫ запускаться из корня репо, иначе ENOENT)
cd /path/to/messenger
node --test shared/test-vectors/contracts.test.mjs
```
