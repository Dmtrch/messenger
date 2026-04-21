# Создание релиза v1.0.0

## Предварительные условия

- Все тесты прошли на ветке `main`
- Код смёржен и актуален
- `CHANGELOG.md` обновлён (при наличии)

## Шаги

### 1. Создай и запушь тег

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### 2. CI запустится автоматически

Workflow `Build Native Clients` стартует при push тега `v*`.

Собираемые артефакты:
- `messenger-1.0.0-macos-arm64.dmg` (macOS Apple Silicon)
- `messenger-1.0.0-macos-x86_64.dmg` (macOS Intel)
- `messenger-1.0.0-linux-x86_64.deb` (Linux)
- `messenger-1.0.0-windows-x86_64.msi` (Windows)
- `messenger-1.0.0-android-arm64.apk` (Android)

Job `publish-release` запускается после успеха всех build-jobs и server-тестов.

### 3. Проверь draft-релиз на GitHub

Перейди в **GitHub → Releases** → найди черновик с названием `Messenger v1.0.0`.

Проверь:
- Все 5 артефактов прикреплены
- Описание корректно
- Тег указывает на правильный коммит

### 4. Опубликуй релиз

Отредактируй описание при необходимости, затем нажми **"Publish release"**.

## Secrets для подписи (опционально)

Без secrets артефакты собираются без подписи. Для подписанных сборок:

| Secret | Назначение |
|--------|-----------|
| `MACOS_CERTIFICATE_BASE64` | macOS code signing cert (p12, base64) |
| `MACOS_CERTIFICATE_PASSWORD` | Пароль к p12 |
| `MACOS_SIGNING_IDENTITY` | Идентификатор подписи (Developer ID) |
| `WINDOWS_PFX_BASE64` | Windows signing cert (pfx, base64) |
| `WINDOWS_PFX_PASSWORD` | Пароль к pfx |
| `ANDROID_KEYSTORE_BASE64` | Android keystore (base64) |
| `ANDROID_KEYSTORE_PASSWORD` | Пароль keystore |
| `ANDROID_KEY_ALIAS` | Alias ключа |
| `ANDROID_KEY_PASSWORD` | Пароль ключа |

## Отмена/исправление тега

Если нужно пересоздать тег:

```bash
# Удалить локально и на remote
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0

# Пересоздать
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

> Примечание: при повторном пуше тега CI запустится снова и перезапишет draft-релиз.
