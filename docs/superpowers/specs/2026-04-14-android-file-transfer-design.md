# Android File Transfer Design

Date: 2026-04-14  
Status: Approved  
Branch: feat/priority3-android-file-transfer

## Overview

Add E2E-encrypted file transfer to the Android client. Images display inline in the message bubble; all other file types show a download card. The implementation mirrors the PWA's `uploadEncryptedMedia` / `fetchEncryptedMediaBlobUrl` logic using `lazysodium-android`, which is already in the project.

## Architecture

```
ChatWindowScreen
  └─ 📎 button → file picker (GetContent)
       └─ ChatWindowViewModel.sendFile(uri, context)
            ├─ ContentResolver → raw bytes + contentType + originalName
            ├─ ApiClient.uploadEncryptedMedia(...)   ← libsodium encrypt → POST /api/media/upload
            ├─ DB migration (schema v1→v2, media columns)
            └─ MessageItem (media fields) → chatStore + DB

MessageBubble
  ├─ image/* → AsyncImage (Coil) + EncryptedMediaFetcher
  └─ other   → filename card + "Скачать" button (MediaStore / Downloads)

EncryptedMediaFetcher (Coil ComponentRegistry)
  └─ ApiClient.fetchDecryptedMedia(mediaId, mediaKeyBase64) → ByteArray
```

## 1. DB Migration (schema version 1 → 2)

The project uses SQLDelight with a single `.sq` file and no existing migrations. Steps:

**a) `build.gradle.kts`** — добавить `schemaVersion = 2` в блок `sqldelight { databases { create(...) { ... } } }`.

**b) `src/main/sqldelight/migrations/1.sqm`** — новый файл (миграция с версии 1 на 2):

```sql
ALTER TABLE message ADD COLUMN media_id      TEXT;
ALTER TABLE message ADD COLUMN media_key     TEXT;   -- base64-encoded 32-byte key
ALTER TABLE message ADD COLUMN original_name TEXT;
ALTER TABLE message ADD COLUMN content_type  TEXT;   -- e.g. "image/jpeg", "application/pdf"
```

**c) `messenger.sq`** — обновить `CREATE TABLE message` и `insertMessage`, добавив 4 новых колонки (чтобы схема и миграции были синхронны).

## 2. MessageItem

```kotlin
data class MessageItem(
    val id: String,
    val clientMsgId: String,
    val chatId: String,
    val senderId: String,
    val plaintext: String,
    val timestamp: Long,
    val status: String,
    val isDeleted: Boolean,
    // media (all null for text messages)
    val mediaId: String? = null,
    val mediaKey: String? = null,       // base64
    val originalName: String? = null,
    val contentType: String? = null,
)
```

A file-only message has empty `plaintext` and non-null `mediaId`.

## 3. Encryption (ApiClient)

Algorithm matches PWA exactly (`crypto_secretbox_easy` = XSalsa20-Poly1305):

```
mediaKey  = randombytes(32)
nonce     = randombytes(24)           // crypto_secretbox_NONCEBYTES
cipher    = secretbox_easy(plain, nonce, mediaKey)
upload    = nonce ++ cipher           // single blob
```

Decryption:
```
nonce     = upload[0..23]
cipher    = upload[24..]
plain     = secretbox_open_easy(cipher, nonce, mediaKey)
```

### New methods in ApiClient.kt

```kotlin
data class MediaUploadResult(val mediaId: String, val mediaKey: String)

suspend fun uploadEncryptedMedia(
    bytes: ByteArray,
    filename: String,
    contentType: String,
    chatId: String,
    msgId: String,
): MediaUploadResult

suspend fun fetchDecryptedMedia(
    mediaId: String,
    mediaKeyBase64: String,
): ByteArray
```

`uploadEncryptedMedia` POSTs to `POST /api/media/upload` as multipart with fields:
- `file` — encrypted binary blob (`application/octet-stream`)
- `chat_id` — chatId
- `msg_id` — msgId

`fetchDecryptedMedia` GETs `/api/media/{mediaId}` (authenticated), splits nonce, decrypts, returns plain bytes.

## 4. ChatWindowViewModel

```kotlin
fun sendFile(uri: Uri, context: Context)
```

1. Read bytes via `context.contentResolver.openInputStream(uri)`
2. Resolve `contentType` via `contentResolver.getType(uri)` (fallback: `application/octet-stream`)
3. Resolve `originalName` via `DocumentFile.fromSingleUri(context, uri)?.name`
4. Generate `clientMsgId = UUID.randomUUID().toString()`
5. Call `apiClient.uploadEncryptedMedia(bytes, name, type, chatId, clientMsgId)`
6. Build `MessageItem` with media fields, empty `plaintext`, status = "sent"
7. Insert into DB + `chatStore.addMessage(chatId, item)`

In-memory media cache inside ViewModel:
```kotlin
private val mediaCache = HashMap<String, ByteArray>()

suspend fun fetchMediaBytes(mediaId: String, mediaKey: String): ByteArray {
    return mediaCache.getOrPut(mediaId) {
        apiClient.fetchDecryptedMedia(mediaId, mediaKey)
    }
}
```

New parameters on `ChatWindowScreen`:
```kotlin
onSendFile: (Uri) -> Unit,
onFetchMedia: suspend (String, String) -> ByteArray,
```

## 5. UI

### ChatWindowScreen — input row

```
[📎]  [  Сообщение...  ]  [➤]
```

```kotlin
val launcher = rememberLauncherForActivityResult(
    ActivityResultContracts.GetContent()
) { uri -> uri?.let { onSendFile(it) } }

IconButton(onClick = { launcher.launch("*/*") }) {
    Icon(Icons.Default.AttachFile, "Прикрепить файл")
}
```

### MessageBubble — display logic

```kotlin
when {
    msg.mediaId != null && msg.contentType?.startsWith("image/") == true ->
        AsyncImage(
            model = EncryptedMediaRequest(msg.mediaId, msg.mediaKey!!),
            contentDescription = msg.originalName,
            modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp).clip(RoundedCornerShape(8.dp))
        )

    msg.mediaId != null ->
        FileCard(name = msg.originalName ?: "файл", onDownload = { /* MediaStore save */ })

    else ->
        Text(msg.plaintext)
}
```

### Coil EncryptedMediaFetcher

Registered in `MessengerApp` as a custom `ImageLoader`:

```kotlin
data class EncryptedMediaRequest(val mediaId: String, val mediaKey: String)

class EncryptedMediaFetcher(
    private val data: EncryptedMediaRequest,
    private val apiClient: ApiClient,
    private val options: Options,
) : Fetcher {
    override suspend fun fetch(): FetchResult {
        val bytes = apiClient.fetchDecryptedMedia(data.mediaId, data.mediaKey)
        val source = Buffer().write(bytes)
        return SourceResult(
            source = ImageSource(source, options.context),
            mimeType = null,
            dataSource = DataSource.NETWORK,
        )
    }

    class Factory(private val apiClient: ApiClient) : Fetcher.Factory<EncryptedMediaRequest> {
        override fun create(data: EncryptedMediaRequest, options: Options, imageLoader: ImageLoader) =
            EncryptedMediaFetcher(data, apiClient, options)
    }
}
```

`ImageLoader` is created once in `MessengerApp` and passed down to composables that need it.

### FileCard (non-image download)

- Shows file icon + `originalName`
- "Скачать" button: reads bytes via `fetchMediaBytes`, saves to `Downloads` using `MediaStore.Downloads` API (Android Q+) or `Environment.getExternalStoragePublicDirectory` (older)

## 6. New Dependency

```kotlin
// apps/mobile/android/build.gradle.kts
implementation("io.coil-kt:coil-compose:2.6.0")
```

## 7. Files Changed

| File | Change |
|------|--------|
| `apps/mobile/android/src/main/sqldelight/migrations/1.sqm` | New — 4 ALTER TABLE statements |
| `apps/mobile/android/src/main/sqldelight/com/messenger/db/messenger.sq` | Add media columns to `CREATE TABLE message` + `insertMessage` |
| `apps/mobile/android/build.gradle.kts` | Set `schemaVersion = 2` в sqldelight конфиге |
| `apps/mobile/android/src/main/kotlin/.../store/AppState.kt` | Add 4 nullable media fields to `MessageItem` |
| `apps/mobile/android/src/main/kotlin/.../service/ApiClient.kt` | Add `MediaUploadResult`, `uploadEncryptedMedia`, `fetchDecryptedMedia` |
| `apps/mobile/android/src/main/kotlin/.../viewmodel/ChatWindowViewModel.kt` | Add `sendFile()`, `fetchMediaBytes()`, media cache |
| `apps/mobile/android/src/main/kotlin/.../ui/screens/ChatWindowScreen.kt` | Add 📎 button, file picker launcher, new params |
| `apps/mobile/android/src/main/kotlin/.../ui/components/MessageBubble.kt` | Add image/file display logic |
| `apps/mobile/android/src/main/kotlin/.../ui/coil/EncryptedMediaFetcher.kt` | New — Coil fetcher |
| `apps/mobile/android/src/main/kotlin/.../MessengerApp.kt` | Register custom `ImageLoader` |
| `apps/mobile/android/build.gradle.kts` | Add `coil-compose:2.6.0` + `schemaVersion = 2` |

## 8. Error Handling

- Upload failure: show `Snackbar("Ошибка загрузки файла")`, message not added to store
- Download/decrypt failure: show placeholder error icon in bubble
- File > 10 MB: check size before upload, show `Snackbar("Файл слишком большой (макс. 10 МБ)")`

## 9. Testing Checklist

1. `./gradlew test` — все существующие тесты зелёные
2. `./gradlew assembleDebug` — APK собирается
3. Ручная проверка: отправить JPG → отображается инлайн
4. Ручная проверка: отправить PDF → показывается карточка, кнопка скачивает файл
5. Перезапуск приложения → медиа отображается (данные из DB)
6. Отправить файл > 10 МБ → Snackbar с ошибкой
