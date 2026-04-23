# Security Audit — Messenger v1.0

**Дата:** 2026-04-20  
**Инструменты:** govulncheck, npm audit, OWASP ручная проверка, trivy  
**Статус:** все находки задокументированы; критичные исправлены

---

## V-2a: govulncheck (Go server)

**Команда:** `cd server && govulncheck ./...`  
**Go version:** go1.26.2 darwin/arm64

### Найденные уязвимости (код вызывает уязвимые пути)

| ID | Пакет | До | После | Severity | Статус |
|----|-------|----|-------|----------|--------|
| GO-2025-3553 | github.com/golang-jwt/jwt/v5 | v5.2.1 | **v5.2.2** | HIGH — DoS при парсинге JWT header | Исправлено |
| GO-2026-4479 | github.com/pion/dtls/v2 | v2.2.12 | v2.2.12 | HIGH — утечка ключа AES GCM в DTLS | Патча нет |

**GO-2025-3553:** `ws/hub.go:997` → `jwt.Parse` → `jwt.Parser.ParseUnverified`. Обновление до v5.2.2 устраняет.

**GO-2026-4479:** `sfu/manager.go` → `webrtc.PeerConnection`. Патч от pion отсутствует на дату аудита. Риск ограничен SFU-модулем (WebRTC/DTLS). Мониторинг: https://pkg.go.dev/vuln/GO-2026-4479

---

## V-2b: npm audit (клиент)

**До исправлений:** 10 уязвимостей (4 HIGH, 6 moderate)  
**После исправлений:** 0 уязвимостей

### Применённые фиксы

| Пакет | Было | Стало |
|-------|------|-------|
| vite | 5.x | **8.0.9** |
| @vitejs/plugin-react | 4.x | **6.0.1** |
| vitest | 2.x | **4.1.4** |
| vite-plugin-pwa | старая | **1.2.0** |
| @vitest/coverage-v8 | 2.x | **4.1.4** |

`package.json` добавлен `overrides.serialize-javascript >= 7.0.5` для защиты транзитивных зависимостей.  
TypeScript type-check: PASS. Production build: PASS.

**Замечание:** все устранённые уязвимости находились в dev/build toolchain (vite, rollup, workbox), не в production bundle. Реальный риск для пользователей был минимален.

---

## V-2c: OWASP Checklist

| # | Категория | Вердикт | Действие |
|---|-----------|---------|---------|
| 1 | Auth Headers | Риск → OK | JWT в URL ограничен WS/SSE путями |
| 2 | CORS | Риск → OK | `Allow-Credentials: true` только при явном ALLOWED_ORIGIN |
| 3 | CSP | OK | `default-src 'self'`, HSTS, X-Frame-Options присутствуют |
| 4 | Input Validation | Риск → OK | Верхние границы username≤64 / password≤128 добавлены |
| 5 | SQL Injection | OK | Все запросы параметризованы |
| 6 | XSS | OK | Небезопасный innerHTML не используется, React экранирует |
| 7 | Rate Limiting | OK | 20 req/min на auth эндпоинты (in-memory) |
| 8 | Hardcoded Secrets | OK | Только тестовые строки, prod — из env |

### Детали исправлений

**CORS (`server/cmd/server/main.go`):**  
При `ALLOWED_ORIGIN=""` (дев-режим) `Access-Control-Allow-Credentials` больше не выставляется.  
Это предотвращает CSRF-атаки через wildcard-reflect origin с credentials.

**JWT в URL (`server/internal/auth/middleware.go`):**  
`?token=` query param разрешён только для путей `/ws` и `*/stream` (WebSocket + SSE).  
На всех остальных маршрутах требуется `Authorization: Bearer` header.

**Input Validation (`server/internal/auth/handler.go`):**  
Добавлены верхние границы: `len(username) > 64 || len(password) > 128` → 400.  
Защищает от DoS через argon2 на сверхдлинных входных данных.

### Известные ограничения (не исправлены)

- **temp_password plaintext** (`db/schema.go`): временный пароль хранится открытым текстом для отображения администратору. Требует отдельного дизайн-решения (шифрование или удаление после первого входа).
- **Rate limiting WS**: WebSocket `/ws` не имеет rate limit на соединения. При горизонтальном масштабировании in-memory limiter неэффективен.
- **Referrer-Policy / Permissions-Policy** заголовки отсутствуют — незначительный пропуск.

---

## V-2d: trivy fs scan

**Команда:** `trivy fs /path/to/messenger --severity HIGH,CRITICAL`

### Go зависимости

| Библиотека | CVE | Было | Стало | Severity | Статус |
|------------|-----|------|-------|----------|--------|
| golang.org/x/crypto | CVE-2025-22869 | v0.31.0 | **v0.35.0** | HIGH — DoS в SSH Key Exchange | Исправлено |

**Замечание:** проект не использует SSH напрямую; crypto используется как транзитивная зависимость pion/webrtc. Обновление устраняет уязвимость с минимальным риском регрессии.

### NPM зависимости

4 HIGH уязвимости в serialize-javascript (build toolchain) — устранены через обновление vite/vitejs экосистемы (см. V-2b).

### Секреты

Hardcoded secrets не обнаружены. `.env.example` содержит только плейсхолдеры.

---

## Итоговый статус

| Категория | Найдено | Исправлено | Осталось |
|-----------|---------|-----------|---------|
| Go CVE (production) | 2 | 1 | 1 (GO-2026-4479, нет патча) |
| NPM CVE | 10 | 10 | 0 |
| OWASP нарушения | 3 | 3 | 0 |
| Hardcoded secrets | 0 | — | 0 |

**Критичных нефиксированных уязвимостей нет.**  
GO-2026-4479 (pion/dtls) требует мониторинга до выхода патча от upstream.
