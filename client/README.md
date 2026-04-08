# Messenger — Client (PWA)

Progressive Web App для безопасного E2E мессенджера.  
Устанавливается на iOS (16.4+) и Android без App Store.

## Стек

| | |
|---|---|
| Framework | React 18 + TypeScript |
| Bundler | Vite 5 |
| PWA | vite-plugin-pwa + кастомный Service Worker |
| State | Zustand |
| Router | React Router 6 |
| Crypto | libsodium-wrappers-sumo (X3DH + Double Ratchet) |
| Key Storage | idb-keyval (IndexedDB) |
| Transport | WebSocket (WSS) |
| Push | Web Push API + VAPID |

## Структура

```
client/
├── public/
│   ├── sw.js              ← Service Worker (кэш + Web Push)
│   ├── manifest.json      ← генерируется vite-plugin-pwa
│   └── icons/             ← icon-192x192.png, icon-512x512.png
├── src/
│   ├── crypto/
│   │   ├── x3dh.ts        ← X3DH key agreement (Signal Protocol)
│   │   ├── ratchet.ts     ← Double Ratchet (forward secrecy)
│   │   └── keystore.ts    ← приватные ключи в IndexedDB (idb-keyval)
│   ├── api/
│   │   ├── client.ts      ← REST HTTP клиент
│   │   └── websocket.ts   ← WSS клиент с backoff
│   ├── store/
│   │   ├── authStore.ts   ← аутентификация (Zustand + persist)
│   │   └── chatStore.ts   ← чаты, сообщения, typing
│   ├── hooks/
│   │   ├── useMessengerWS.ts       ← глобальный WS хук
│   │   └── usePushNotifications.ts ← VAPID подписка
│   ├── components/
│   │   ├── ChatList/      ← список чатов
│   │   ├── ChatWindow/    ← экран переписки
│   │   └── Profile/       ← профиль пользователя
│   ├── pages/             ← страницы-роуты
│   └── types/index.ts     ← TypeScript типы
├── vite.config.ts
└── package.json
```

## Быстрый старт

```bash
cd client
cp .env.example .env        # настроить VAPID ключ (URL сервера не нужен)
npm install
npm run dev                  # http://localhost:3000
```

### Сборка

```bash
npm run build
npm run preview
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | VAPID public key для Web Push (base64url) |

`VITE_API_URL` и `VITE_WS_URL` больше не используются — адрес сервера определяется автоматически из `window.location`.

## Режимы запуска

**Продакшн:** клиент раздаётся напрямую с Go сервера (embed). URL API и WebSocket определяются из текущего адреса браузера — никакой настройки не нужно.

**Разработка:** `npm run dev` запускает Vite на порту 3000. Все запросы `/api`, `/ws` и `/media` автоматически проксируются на `localhost:8080` (Go сервер).

## E2E шифрование

Схема Signal Protocol — две фазы:

**1. X3DH (первый контакт)**
- Генерация ключей при регистрации: Identity Key (Ed25519), Signed PreKey (X25519), One-Time PreKeys (X25519)
- Приватные ключи хранятся исключительно в IndexedDB устройства
- Сервер хранит только публичные ключи

**2. Double Ratchet (переписка)**
- Каждое сообщение шифруется новым ключом (симметричный рэтчет)
- Периодическая смена DH ключей (DH рэтчет) — break-in recovery
- Алгоритм шифрования: XSalsa20-Poly1305 (libsodium secretbox)

## PWA — установка на устройство

**iOS Safari:** Поделиться → Добавить на экран "Домой"

**Android Chrome:** Меню ⋮ → Установить приложение

**Требования:** HTTPS с валидным сертификатом (Let's Encrypt или mkcert для локальной сети)

## Web Push уведомления

- Поддерживается iOS 16.4+ (Safari) и Android (Chrome)
- При входе запрашивается разрешение на уведомления
- VAPID ключ генерируется на сервере при первом запуске
- Service Worker обрабатывает push когда приложение закрыто

## API контракт

Все детали в `/docs/architecture.md` (раздел "API-контракт").

Основные эндпоинты:
- `POST /api/auth/register` — регистрация с публичными ключами
- `GET  /api/keys/:userId` — получение X3DH ключей пользователя
- `GET  /api/chats` — список чатов
- `WSS  /ws?token=<JWT>` — real-time события

## Роутинг

| Путь | Страница |
|---|---|
| `/auth` | Регистрация / вход |
| `/` | Список чатов |
| `/chat/:chatId` | Переписка |
| `/profile` | Профиль |

## TODO (следующие итерации)

- [ ] Интеграция Double Ratchet с WebSocket: шифрование исходящих, расшифровка входящих
- [ ] Пагинация истории сообщений (бесконечный скролл вверх)
- [ ] Поддержка медиафайлов (изображения, файлы)
- [ ] Групповые чаты (Sender Keys)
- [ ] Кэширование skipped message keys в Double Ratchet
