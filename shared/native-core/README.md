# Shared Native Core

Стартовый runtime-модуль для будущих нативных клиентов.

Назначение:

- быть первым местом, где общие protocol/domain contracts начнут превращаться в runtime-артефакты;
- оставаться platform-neutral;
- зависеть от `shared/protocol`, `shared/domain`, `shared/crypto-contracts`, `shared/test-vectors`, а не от конкретных UI или OS adapters.

На текущем шаге это ещё не реализация бизнес-логики. Это стартовая модульная граница, вокруг которой дальше будут строиться:

- `auth`
- `websocket`
- `sync`
- `crypto`
- `storage`
- `messages`

Ограничения:

- без platform-specific API;
- без UI;
- без расхождения с текущим runtime web-протоколом.

## Package Boundary

`shared/native-core` оформлен как отдельный TS-модуль с entrypoint `index.ts` и export map в `package.json`.

Назначение этого шага:

- дать стабильную import-границу для `apps/desktop` и будущих mobile-клиентов;
- отделить shared runtime API от внутренней структуры файлов;
- подготовить слой к последующему выносу web-specific crypto реализации из `client/src/crypto/*`.

Текущая оговорка:

- `WebCryptoAdapter` пока переиспользует реализацию из `client/src/crypto/*`, поэтому package boundary уже есть, но полная source-isolation ещё не завершена.
