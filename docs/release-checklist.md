# Release Checklist

Операционный документ для деплоя, резервного копирования и аварийного восстановления.

---

## 1. Pre-release Checklist

- [ ] `cd server && go test ./...` — все тесты проходят
- [ ] `cd client && npm run type-check` — TypeScript компилируется без ошибок
- [ ] `cd client && npm run lint` — lint чистый (zero warnings)
- [ ] `cd server && govulncheck ./...` — нет известных уязвимостей
- [ ] CHANGELOG.md обновлён
- [ ] Версии синхронизированы: `client/package.json`, `apps/desktop/build.gradle.kts`, `apps/mobile/android/build.gradle.kts`, `apps/mobile/ios/Sources/Messenger/BuildConfig.swift`
- [ ] `.env.example` актуален (новые переменные добавлены)
- [ ] Backup БД сделан перед деплоем (см. раздел 2)
- [ ] CI green на ветке `main`

---

## 2. Backup Procedure

### SQLite (hot backup без остановки сервера)

```bash
sqlite3 /data/messenger.db "VACUUM INTO '/backup/messenger-$(date +%Y%m%d-%H%M%S).db'"
```

### Медиафайлы

```bash
tar -czf /backup/media-$(date +%Y%m%d).tar.gz /data/media/
```

### Docker volume (полный backup данных)

```bash
docker run --rm \
  -v messenger_data:/data \
  -v /backup:/backup \
  alpine tar -czf /backup/messenger-data-$(date +%Y%m%d-%H%M%S).tar.gz /data
```

### Автоматизация (cron)

```cron
# Ежедневный backup в 03:00, хранить 7 дней
0 3 * * * sqlite3 /data/messenger.db "VACUUM INTO '/backup/messenger-$(date +\%Y\%m\%d).db'" && find /backup -name "messenger-*.db" -mtime +7 -delete
```

---

## 3. Deploy Procedure

```bash
# 1. Pull latest image
docker compose pull

# 2. Перезапустить сервис
docker compose up -d --no-deps messenger

# 3. Проверить health
curl -f http://localhost:8080/api/server/info

# 4. Смотреть логи (2 минуты после старта)
docker compose logs -f messenger --since 2m
```

---

## 4. Rollback Procedure

### Откат образа

```bash
docker compose down
# Указать предыдущий тег или digest
docker compose up -d
```

### Откат БД (только если миграции обратимы)

```bash
scripts/db-migrate.sh --db /data/messenger.db --rollback <prev_version>
```

> **Внимание:** команда удаляет только запись из `schema_migrations`, данные не откатываются.

### Восстановление из backup

```bash
docker compose down

docker run --rm \
  -v messenger_data:/data \
  -v /backup:/backup \
  alpine sh -c "cd /data && tar -xzf /backup/messenger-data-<timestamp>.tar.gz --strip-components=1"

docker compose up -d
```

---

## 5. Monitoring Setup

| Что | Как |
|-----|-----|
| Health endpoint | `GET /api/server/info` → 200 OK |
| Admin metrics (SSE) | `GET /api/admin/stats` — CPU/RAM/Disk в реальном времени |
| Docker health | `docker inspect messenger --format='{{.State.Health.Status}}'` |
| Внешний монитор | UptimeRobot / Better Uptime → `/api/server/info` |
| Логи с ошибками | `docker compose logs messenger \| grep -E 'ERROR\|WARN'` |

### Рекомендуемые алерты

- Health check failures > 2 подряд
- Disk usage > 80% (медиафайлы растут)
- Response time > 2s
- Memory usage > 90%

---

## 6. Key Rotation Guide

### JWT Secret

```bash
# 1. Сгенерировать новый секрет
NEW_SECRET=$(openssl rand -hex 32)

# 2. Обновить JWT_SECRET в .env

# 3. Перезапустить сервер
docker compose restart messenger
```

> **Внимание:** ротация `JWT_SECRET` немедленно инвалидирует все существующие токены. Все пользователи будут выкинуты из сессии и должны заново войти.

### VAPID Keys (Web Push)

```bash
# Сгенерировать новую пару ключей
node -e "const w=require('web-push'); const k=w.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"

# Обновить VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY в .env
docker compose restart messenger
```

> **Внимание:** после ротации VAPID ключей все существующие push-подписки браузеров становятся невалидными. Пользователям нужно заново подписаться на уведомления.

### TLS Certificates

```bash
# Обновить файлы cert/key, затем:
docker compose restart messenger
```

---

## 7. Post-deploy Verification

- [ ] `curl https://your-domain.com/api/server/info` возвращает 200
- [ ] WebSocket соединение устанавливается (`/ws`)
- [ ] Логин работает
- [ ] Отправка сообщения работает
- [ ] Загрузка медиафайла работает
- [ ] Admin panel доступна (`/api/admin/*`)
