# Android-клиент Messenger — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать полноценный Android-клиент мессенджера в `apps/mobile/android/` — авторизация, список чатов, E2E-шифрование, offline outbox, cursor-based пагинация.

**Architecture:** Standalone Gradle Android-модуль (не KMP). Логика crypto/store/viewmodel копируется из `apps/desktop/`, platform-зависимости заменяются: `lazysodium-android` (JNI), Ktor OkHttp engine, SQLDelight android-driver, AndroidViewModel, EncryptedSharedPreferences. Desktop не затрагивается.

**Tech Stack:** Kotlin 2.0.21 · Android Gradle Plugin 8.5.0 · Jetpack Compose BOM 2024.09.00 · Ktor 3.1.2 + OkHttp · lazysodium-android 5.1.4 · SQLDelight 2.0.2 · androidx.security:crypto 1.1.0-alpha06

**Spec:** `docs/superpowers/specs/2026-04-13-android-client-design.md`  
**Desktop reference:** `apps/desktop/src/main/kotlin/`

---

## Карта файлов

| Файл | Откуда | Изменения |
|---|---|---|
| `build.gradle.kts` | новый | Android application |
| `settings.gradle.kts` | новый | standalone root project |
| `gradle/libs.versions.toml` | новый | Android deps |
| `src/main/AndroidManifest.xml` | новый | INTERNET + POST_NOTIFICATIONS |
| `src/main/kotlin/.../MainActivity.kt` | новый | setContent { App(application) } |
| `src/main/kotlin/.../store/AppState.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../store/AuthStore.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../store/ChatStore.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../config/ServerConfig.kt` | Desktop adapt | SharedPreferences |
| `src/main/kotlin/.../service/TokenStore.kt` | Desktop adapt | EncryptedSharedPreferences |
| `src/main/kotlin/.../crypto/KeyStorage.kt` | Desktop adapt | EncryptedSharedPreferences |
| `src/main/sqldelight/.../messenger.sq` | Desktop copy | без изменений |
| `src/main/kotlin/.../db/DatabaseProvider.kt` | Desktop adapt | AndroidSqliteDriver |
| `src/main/kotlin/.../crypto/X3DH.kt` | Desktop adapt | LazySodiumAndroid |
| `src/main/kotlin/.../crypto/Ratchet.kt` | Desktop adapt | LazySodiumAndroid |
| `src/main/kotlin/.../crypto/SenderKey.kt` | Desktop adapt | LazySodiumAndroid |
| `src/main/kotlin/.../service/ApiClient.kt` | Desktop adapt | OkHttp engine |
| `src/main/kotlin/.../service/MessengerWS.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../service/WSOrchestrator.kt` | Desktop adapt | db: MessengerDatabase параметр |
| `src/main/kotlin/.../viewmodel/AppViewModel.kt` | Desktop adapt | AndroidViewModel |
| `src/main/kotlin/.../viewmodel/ChatListViewModel.kt` | Desktop adapt | AndroidViewModel |
| `src/main/kotlin/.../viewmodel/ChatWindowViewModel.kt` | Desktop adapt | db-параметр |
| `src/main/kotlin/.../ui/App.kt` | Desktop adapt | App(application: Application) |
| `src/main/kotlin/.../ui/screens/ServerSetupScreen.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/screens/AuthScreen.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/screens/ChatListScreen.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/screens/ChatWindowScreen.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/screens/ProfileScreen.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/components/MessageBubble.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../ui/components/TypingIndicator.kt` | Desktop copy | без изменений |
| `src/main/kotlin/.../push/FcmService.kt` | новый | stub |
| `src/test/kotlin/.../crypto/X3DHTest.kt` | Desktop adapt | LazySodiumAndroid |
| `src/test/kotlin/.../crypto/RatchetTest.kt` | Desktop adapt | LazySodiumAndroid |

Все пути внутри `src/main/kotlin/` используют пакет `com.messenger`.

---

## Task 1: Gradle scaffold

**Files:**
- Create: `apps/mobile/android/settings.gradle.kts`
- Create: `apps/mobile/android/build.gradle.kts`
- Create: `apps/mobile/android/gradle/libs.versions.toml`

- [ ] **Step 1: Создать `apps/mobile/android/settings.gradle.kts`**

```kotlin
// apps/mobile/android/settings.gradle.kts
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "messenger-android"
```

- [ ] **Step 2: Создать `apps/mobile/android/gradle/libs.versions.toml`**

```toml
# apps/mobile/android/gradle/libs.versions.toml
[versions]
kotlin = "2.0.21"
agp = "8.5.0"
compose-bom = "2024.09.00"
ktor = "3.1.2"
serialization = "1.7.3"
lazysodium-android = "5.1.4"
sqldelight = "2.0.2"
coroutines = "1.8.1"
security-crypto = "1.1.0-alpha06"
lifecycle = "2.8.0"
activity-compose = "1.9.2"
junit = "5.10.2"

[libraries]
compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }
compose-material3 = { group = "androidx.compose.material3", name = "material3" }
compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
compose-activity = { group = "androidx.activity", name = "activity-compose", version.ref = "activity-compose" }
compose-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
ktor-client-okhttp = { module = "io.ktor:ktor-client-okhttp", version.ref = "ktor" }
ktor-client-content-negotiation = { module = "io.ktor:ktor-client-content-negotiation", version.ref = "ktor" }
ktor-client-auth = { module = "io.ktor:ktor-client-auth", version.ref = "ktor" }
ktor-serialization-json = { module = "io.ktor:ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-websockets = { module = "io.ktor:ktor-client-websockets", version.ref = "ktor" }
ktor-client-mock = { module = "io.ktor:ktor-client-mock", version.ref = "ktor" }
serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
lazysodium-android = { module = "com.goterl:lazysodium-android", version.ref = "lazysodium-android" }
sqldelight-android-driver = { module = "app.cash.sqldelight:android-driver", version.ref = "sqldelight" }
coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
security-crypto = { module = "androidx.security:crypto", version.ref = "security-crypto" }
lifecycle-viewmodel = { module = "androidx.lifecycle:lifecycle-viewmodel-ktx", version.ref = "lifecycle" }
lifecycle-viewmodel-compose = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
sqldelight = { id = "app.cash.sqldelight", version.ref = "sqldelight" }
```

- [ ] **Step 3: Создать `apps/mobile/android/build.gradle.kts`**

```kotlin
// apps/mobile/android/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.sqldelight)
}

android {
    namespace = "com.messenger"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.messenger"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    testOptions {
        unitTests.all { it.useJUnitPlatform() }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.activity)
    implementation(libs.compose.icons.extended)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.client.auth)
    implementation(libs.ktor.serialization.json)
    implementation(libs.ktor.client.websockets)
    implementation(libs.serialization.json)
    implementation(libs.lazysodium.android)
    implementation(libs.sqldelight.android.driver)
    implementation(libs.coroutines.android)
    implementation(libs.security.crypto)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.viewmodel.compose)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}

sqldelight {
    databases {
        create("MessengerDatabase") {
            packageName.set("com.messenger.db")
            srcDirs("src/main/sqldelight")
        }
    }
}
```

- [ ] **Step 4: Инициализировать Gradle wrapper**

```bash
cd apps/mobile/android
gradle wrapper --gradle-version 8.8
```

Ожидается: появятся `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`.

- [ ] **Step 5: Проверить синхронизацию**

```bash
cd apps/mobile/android
./gradlew dependencies --configuration releaseRuntimeClasspath 2>&1 | head -30
```

Ожидается: Gradle успешно разрешает зависимости без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add apps/mobile/android/settings.gradle.kts apps/mobile/android/build.gradle.kts apps/mobile/android/gradle/
git commit -m "feat(android): Gradle scaffold — AGP 8.5 + Compose + Ktor + SQLDelight"
```

---

## Task 2: AndroidManifest.xml и data models

**Files:**
- Create: `apps/mobile/android/src/main/AndroidManifest.xml`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`

- [ ] **Step 1: Создать `src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:name=".MessengerApp"
        android:label="Messenger"
        android:theme="@style/Theme.AppCompat.DayNight.NoActionBar"
        android:allowBackup="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>

</manifest>
```

Примечание: `android:theme` использует AppCompat тему — добавить её в `src/main/res/values/themes.xml` если понадобится кастомизация. Для MVP достаточно стандартной Compose Material3 темы без дополнительных ресурсов.

- [ ] **Step 2: Создать `src/main/kotlin/com/messenger/store/AppState.kt`**

Копируем data classes из Desktop без изменений:

```kotlin
// src/main/kotlin/com/messenger/store/AppState.kt
package com.messenger.store

data class ChatItem(
    val id: String,
    val name: String,
    val isGroup: Boolean,
    val lastMessage: String?,
    val updatedAt: Long,
    val unreadCount: Int = 0,
)

data class MessageItem(
    val id: String,
    val clientMsgId: String,
    val chatId: String,
    val senderId: String,
    val plaintext: String,
    val timestamp: Long,
    val status: String,
    val isDeleted: Boolean,
)

data class AuthState(
    val isAuthenticated: Boolean = false,
    val userId: String = "",
    val username: String = "",
    val accessToken: String = "",
)
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/AndroidManifest.xml apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt
git commit -m "feat(android): AndroidManifest + data models"
```

---

## Task 3: ServerConfig

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/config/ServerConfig.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/MessengerApp.kt`

Desktop использует `java.util.prefs.Preferences` — на Android нет. Заменяем на `SharedPreferences`.

- [ ] **Step 1: Создать `ServerConfig.kt`**

```kotlin
// src/main/kotlin/com/messenger/config/ServerConfig.kt
package com.messenger.config

import android.content.Context
import android.content.SharedPreferences

object ServerConfig {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("messenger_config", Context.MODE_PRIVATE)
    }

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(value) { prefs.edit().putString("server_url", value).apply() }

    fun hasServerUrl(): Boolean = serverUrl.isNotEmpty()
}
```

- [ ] **Step 2: Создать `MessengerApp.kt` для инициализации**

`ServerConfig.init` нужно вызвать до первого использования. Делаем это в `Application.onCreate()`:

```kotlin
// src/main/kotlin/com/messenger/MessengerApp.kt
package com.messenger

import android.app.Application
import com.messenger.config.ServerConfig

class MessengerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServerConfig.init(this)
    }
}
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/config/ apps/mobile/android/src/main/kotlin/com/messenger/MessengerApp.kt
git commit -m "feat(android): ServerConfig (SharedPreferences) + MessengerApp"
```

---

## Task 4: TokenStore

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/TokenStore.kt`

Desktop хранит токены в `java.util.prefs.Preferences`. Android-версия использует `EncryptedSharedPreferences`.

- [ ] **Step 1: Создать `TokenStore.kt`**

```kotlin
// src/main/kotlin/com/messenger/service/TokenStore.kt
package com.messenger.service

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

interface TokenStoreInterface {
    var accessToken: String
    var refreshToken: String
    fun save(accessToken: String, refreshToken: String)
    fun clear()
}

class TokenStore(context: Context) : TokenStoreInterface {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "messenger_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override var accessToken: String
        get() = prefs.getString("access_token", "") ?: ""
        set(value) { prefs.edit().putString("access_token", value).apply() }

    override var refreshToken: String
        get() = prefs.getString("refresh_token", "") ?: ""
        set(value) { prefs.edit().putString("refresh_token", value).apply() }

    override fun save(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .apply()
    }

    override fun clear() {
        prefs.edit()
            .remove("access_token")
            .remove("refresh_token")
            .apply()
    }
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/service/TokenStore.kt
git commit -m "feat(android): TokenStore (EncryptedSharedPreferences)"
```

---

## Task 5: KeyStorage

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/crypto/KeyStorage.kt`

Desktop хранит ключи в PKCS12-файле. Android-версия использует `EncryptedSharedPreferences` с Base64-кодированием байтов.

- [ ] **Step 1: Создать `KeyStorage.kt`**

```kotlin
// src/main/kotlin/com/messenger/crypto/KeyStorage.kt
package com.messenger.crypto

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class KeyStorage(context: Context) : AutoCloseable {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "messenger_crypto_keys",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveKey(alias: String, keyBytes: ByteArray) {
        prefs.edit()
            .putString(alias, Base64.encodeToString(keyBytes, Base64.NO_WRAP))
            .apply()
    }

    fun loadKey(alias: String): ByteArray? {
        val encoded = prefs.getString(alias, null) ?: return null
        return Base64.decode(encoded, Base64.NO_WRAP)
    }

    fun deleteKey(alias: String) {
        prefs.edit().remove(alias).apply()
    }

    override fun close() { /* нет ресурсов для освобождения */ }
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/crypto/KeyStorage.kt
git commit -m "feat(android): KeyStorage (EncryptedSharedPreferences + Base64)"
```

---

## Task 6: DatabaseProvider + схема

**Files:**
- Create: `apps/mobile/android/src/main/sqldelight/com/messenger/db/messenger.sq`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/db/DatabaseProvider.kt`

- [ ] **Step 1: Создать `messenger.sq`** — идентична Desktop схеме

```sql
-- src/main/sqldelight/com/messenger/db/messenger.sq
CREATE TABLE IF NOT EXISTS chat (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
);

insertChat:
INSERT OR REPLACE INTO chat(id, name, is_group, last_message, updated_at)
VALUES (?, ?, ?, ?, ?);

getAllChats:
SELECT * FROM chat ORDER BY updated_at DESC;

getChatById:
SELECT * FROM chat WHERE id = ?;

CREATE TABLE IF NOT EXISTS message (
    id TEXT NOT NULL PRIMARY KEY,
    client_msg_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    is_deleted INTEGER NOT NULL DEFAULT 0
);

insertMessage:
INSERT OR REPLACE INTO message(id, client_msg_id, chat_id, sender_id, plaintext, timestamp, status, is_deleted)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

getMessagesForChat:
SELECT * FROM message
WHERE chat_id = ? AND is_deleted = 0
ORDER BY timestamp ASC;

getMessagesBefore:
SELECT * FROM message
WHERE chat_id = ? AND timestamp < ? AND is_deleted = 0
ORDER BY timestamp DESC
LIMIT ?;

softDeleteMessage:
UPDATE message SET is_deleted = 1 WHERE client_msg_id = ?;

updateMessageStatus:
UPDATE message SET status = ? WHERE client_msg_id = ?;

CREATE TABLE IF NOT EXISTS ratchet_session (
    session_key TEXT NOT NULL PRIMARY KEY,
    state BLOB NOT NULL
);

saveRatchetSession:
INSERT OR REPLACE INTO ratchet_session(session_key, state) VALUES (?, ?);

loadRatchetSession:
SELECT state FROM ratchet_session WHERE session_key = ?;

CREATE TABLE IF NOT EXISTS outbox (
    client_msg_id TEXT NOT NULL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

insertOutbox:
INSERT OR REPLACE INTO outbox(client_msg_id, chat_id, plaintext, created_at) VALUES (?, ?, ?, ?);

deleteOutbox:
DELETE FROM outbox WHERE client_msg_id = ?;

getAllOutbox:
SELECT * FROM outbox ORDER BY created_at ASC;
```

- [ ] **Step 2: Создать `DatabaseProvider.kt`**

Android-версия — класс (не object), принимает `Context`:

```kotlin
// src/main/kotlin/com/messenger/db/DatabaseProvider.kt
package com.messenger.db

import android.content.Context
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.messenger.db.MessengerDatabase

class DatabaseProvider(context: Context) {
    val database: MessengerDatabase by lazy {
        MessengerDatabase(AndroidSqliteDriver(MessengerDatabase.Schema, context, "messenger.db"))
    }
}
```

- [ ] **Step 3: Собрать SQLDelight codegen**

```bash
cd apps/mobile/android
./gradlew generateDebugDatabaseInterface
```

Ожидается: генерируется `MessengerDatabase` в `build/generated/sqldelight/`.

- [ ] **Step 4: Коммит**

```bash
git add apps/mobile/android/src/main/sqldelight/ apps/mobile/android/src/main/kotlin/com/messenger/db/
git commit -m "feat(android): SQLDelight schema + DatabaseProvider (AndroidSqliteDriver)"
```

---

## Task 7: Crypto — X3DH, Ratchet, SenderKey

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/crypto/X3DH.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/crypto/Ratchet.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/crypto/SenderKey.kt`

Логика идентична Desktop. Единственное изменение: `LazySodiumJava` → `LazySodiumAndroid`.

- [ ] **Step 1: Создать `X3DH.kt`**

```kotlin
// src/main/kotlin/com/messenger/crypto/X3DH.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid

class X3DH(private val sodium: LazySodiumAndroid) {

    fun computeSharedSecret(
        aliceIKPrivEd: ByteArray,
        aliceEKPriv: ByteArray,
        bobIKPubEd: ByteArray,
        bobSPKPub: ByteArray,
        bobOPKPub: ByteArray? = null,
    ): ByteArray {
        val aliceIKCurvePriv = ed25519SkToCurve25519(aliceIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)
        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        val dh2 = scalarmult(aliceEKPriv, bobIKCurvePub)
        val dh3 = scalarmult(aliceEKPriv, bobSPKPub)
        val combined = if (bobOPKPub != null) {
            val dh4 = scalarmult(aliceEKPriv, bobOPKPub)
            dh1 + dh2 + dh3 + dh4
        } else {
            dh1 + dh2 + dh3
        }
        return genericHash(combined, 32)
    }

    private fun scalarmult(priv: ByteArray, pub: ByteArray): ByteArray {
        require(priv.size == 32) { "curve25519 private key must be 32 bytes, got ${priv.size}" }
        require(pub.size == 32) { "curve25519 public key must be 32 bytes, got ${pub.size}" }
        val out = ByteArray(32)
        check(sodium.cryptoScalarMult(out, priv, pub)) { "cryptoScalarMult failed" }
        return out
    }

    private fun genericHash(input: ByteArray, outLen: Int): ByteArray {
        val out = ByteArray(outLen)
        check(sodium.cryptoGenericHash(out, outLen, input, input.size.toLong(), null, 0)) {
            "cryptoGenericHash failed"
        }
        return out
    }

    private fun ed25519PkToCurve25519(edPk: ByteArray): ByteArray {
        require(edPk.size == 32) { "ed25519 public key must be 32 bytes, got ${edPk.size}" }
        val out = ByteArray(32)
        check(sodium.convertPublicKeyEd25519ToCurve25519(out, edPk)) {
            "ed25519PkToCurve25519 failed"
        }
        return out
    }

    private fun ed25519SkToCurve25519(edSk: ByteArray): ByteArray {
        require(edSk.size == 64) { "ed25519 secret key must be 64 bytes, got ${edSk.size}" }
        val out = ByteArray(32)
        check(sodium.convertSecretKeyEd25519ToCurve25519(out, edSk)) {
            "ed25519SkToCurve25519 failed"
        }
        return out
    }
}
```

- [ ] **Step 2: Создать `Ratchet.kt`**

```kotlin
// src/main/kotlin/com/messenger/crypto/Ratchet.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.interfaces.SecretBox

class Ratchet(private val sodium: LazySodiumAndroid) {

    companion object {
        private val NONCEBYTES = SecretBox.NONCEBYTES
        private val MACBYTES = SecretBox.MACBYTES
    }

    fun deriveMessageKey(chainKey: ByteArray, index: Int): ByteArray {
        require(chainKey.size == 32) { "chainKey must be 32 bytes, got ${chainKey.size}" }
        val out = ByteArray(32)
        val context = "msg_key_".toByteArray(Charsets.UTF_8)
        val result = sodium.cryptoKdfDeriveFromKey(out, 32, index.toLong(), context, chainKey)
        check(result == 0) { "cryptoKdfDeriveFromKey failed with code $result" }
        return out
    }

    fun encrypt(plaintext: ByteArray, msgKey: ByteArray): Pair<ByteArray, ByteArray> {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        val nonce = sodium.randomBytesBuf(NONCEBYTES)
        return encryptWithNonce(plaintext, msgKey, nonce)
    }

    fun encryptWithNonce(plaintext: ByteArray, msgKey: ByteArray, nonce: ByteArray): Pair<ByteArray, ByteArray> {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        val ciphertext = ByteArray(plaintext.size + MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxEasy failed"
        }
        return ciphertext to nonce
    }

    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, msgKey: ByteArray): ByteArray {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        require(ciphertext.size >= MACBYTES) { "ciphertext too short" }
        val plaintext = ByteArray(ciphertext.size - MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxOpenEasy failed — wrong key or corrupted ciphertext"
        }
        return plaintext
    }
}
```

- [ ] **Step 3: Создать `SenderKey.kt`**

```kotlin
// src/main/kotlin/com/messenger/crypto/SenderKey.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.interfaces.SecretBox

class SenderKey(private val sodium: LazySodiumAndroid) {

    companion object {
        private const val NONCEBYTES = SecretBox.NONCEBYTES
        private const val MACBYTES   = SecretBox.MACBYTES
    }

    fun encrypt(plaintext: ByteArray, senderKey: ByteArray): Pair<ByteArray, ByteArray> {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        val nonce = sodium.randomBytesBuf(NONCEBYTES)
        return encryptWithNonce(plaintext, senderKey, nonce) to nonce
    }

    fun encryptWithNonce(plaintext: ByteArray, senderKey: ByteArray, nonce: ByteArray): ByteArray {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        val ciphertext = ByteArray(plaintext.size + MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, senderKey)) {
            "SenderKey encrypt failed"
        }
        return ciphertext
    }

    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, senderKey: ByteArray): ByteArray {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        require(ciphertext.size >= MACBYTES) { "ciphertext too short" }
        val plaintext = ByteArray(ciphertext.size - MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, senderKey)) {
            "SenderKey decrypt failed — wrong key or corrupted ciphertext"
        }
        return plaintext
    }
}
```

- [ ] **Step 4: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/crypto/X3DH.kt apps/mobile/android/src/main/kotlin/com/messenger/crypto/Ratchet.kt apps/mobile/android/src/main/kotlin/com/messenger/crypto/SenderKey.kt
git commit -m "feat(android): crypto X3DH + Ratchet + SenderKey (lazysodium-android)"
```

---

## Task 8: Crypto тесты

**Files:**
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/crypto/X3DHTest.kt`
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/crypto/RatchetTest.kt`

Это JVM unit-тесты (не instrumented). `lazysodium-android` работает в JVM тестах через JNI.

> **Важно:** тест-векторы лежат в `shared/test-vectors/`. Относительный путь от `apps/mobile/android/` — `"../../../shared/test-vectors/$name.json"`.

- [ ] **Step 1: Написать failing test для X3DH**

```kotlin
// src/test/kotlin/com/messenger/crypto/X3DHTest.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class X3DHTest {
    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val b64 = Base64.getDecoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `x3dh shared secret matches web test vector`() {
        val v = loadVector("x3dh")

        val aliceIKPriv = b64.decode(v["aliceIdentityKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val aliceEKPriv = b64.decode(v["aliceEphemeralKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val bobIKPub = b64.decode(v["bobIdentityKeyPair"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val bobSPKPub = b64.decode(v["bobSignedPreKey"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val bobOPKPub = b64.decode(v["bobOneTimePreKey"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val expected = v["expectedSharedSecret"]!!.jsonPrimitive.content

        val result = X3DH(sodium).computeSharedSecret(
            aliceIKPrivEd = aliceIKPriv,
            aliceEKPriv = aliceEKPriv,
            bobIKPubEd = bobIKPub,
            bobSPKPub = bobSPKPub,
            bobOPKPub = bobOPKPub,
        )

        assertEquals(expected, Base64.getEncoder().encodeToString(result))
    }
}
```

- [ ] **Step 2: Запустить — убедиться что FAIL**

```bash
cd apps/mobile/android
./gradlew test --tests "com.messenger.crypto.X3DHTest" 2>&1 | tail -20
```

Ожидается: FAIL (класс `X3DH` уже создан в Task 7, тест должен PASS — перейти к Step 3).

- [ ] **Step 3: Написать тесты Ratchet**

```kotlin
// src/test/kotlin/com/messenger/crypto/RatchetTest.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class RatchetTest {
    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val b64Dec = Base64.getDecoder()
    private val b64Enc = Base64.getEncoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `deriveMessageKey matches web test vector`() {
        val v = loadVector("ratchet")
        val chainKey = b64Dec.decode(v["chainKey"]!!.jsonPrimitive.content)
        val index = v["messageIndex"]!!.jsonPrimitive.int
        val expected = v["expectedMsgKey"]!!.jsonPrimitive.content

        val msgKey = Ratchet(sodium).deriveMessageKey(chainKey, index)

        assertEquals(expected, b64Enc.encodeToString(msgKey))
    }

    @Test
    fun `encrypt then decrypt round-trip`() {
        val ratchet = Ratchet(sodium)
        val chainKey = ByteArray(32) { it.toByte() }
        val msgKey = ratchet.deriveMessageKey(chainKey, 0)
        val plaintext = "hello ratchet"

        val (ciphertext, nonce) = ratchet.encrypt(plaintext.toByteArray(), msgKey)
        assertEquals(plaintext.toByteArray().size + 16, ciphertext.size)
        val decrypted = ratchet.decrypt(ciphertext, nonce, msgKey)

        assertEquals(plaintext, String(decrypted))
    }

    @Test
    fun `encrypt ciphertext matches web test vector`() {
        val v = loadVector("ratchet")
        val msgKey = b64Dec.decode(v["expectedMsgKey"]!!.jsonPrimitive.content)
        val nonce = b64Dec.decode(v["nonce"]!!.jsonPrimitive.content)
        val plaintext = v["plaintext"]!!.jsonPrimitive.content
        val expected = v["expectedCiphertext"]!!.jsonPrimitive.content

        val (ciphertext, _) = Ratchet(sodium).encryptWithNonce(plaintext.toByteArray(), msgKey, nonce)

        assertEquals(expected, b64Enc.encodeToString(ciphertext))
    }
}
```

- [ ] **Step 4: Запустить все crypto тесты — должны PASS**

```bash
cd apps/mobile/android
./gradlew test --tests "com.messenger.crypto.*"
```

Ожидается: `BUILD SUCCESSFUL`, 4 теста зелёных.

- [ ] **Step 5: Коммит**

```bash
git add apps/mobile/android/src/test/kotlin/com/messenger/crypto/
git commit -m "test(android): crypto tests — X3DH + Ratchet совместимы с test vectors"
```

---

## Task 9: ApiClient

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt`

Логика идентична Desktop. Заменяем `CIO` на `OkHttp` engine.

- [ ] **Step 1: Создать `ApiClient.kt`**

```kotlin
// src/main/kotlin/com/messenger/service/ApiClient.kt
package com.messenger.service

import io.ktor.client.*
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.auth.*
import io.ktor.client.plugins.auth.providers.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class LoginResponse(val accessToken: String, val refreshToken: String)
@Serializable data class RefreshResponse(val accessToken: String, val refreshToken: String)
@Serializable data class ChatSummaryDto(
    val id: String,
    val name: String,
    val isGroup: Boolean,
    val updatedAt: Long,
)
@Serializable data class SendMessageRequest(
    val chatId: String,
    val clientMsgId: String,
    val senderKeyId: Int,
    val recipients: List<RecipientDto>,
)
@Serializable data class RecipientDto(val userId: String, val deviceId: String?, val ciphertext: String)
@Serializable data class RegisterKeysRequest(
    val identityKey: String,
    val signedPreKey: String,
    val signedPreKeySignature: String,
    val oneTimePreKeys: List<String>,
)

private val applicationJson = ContentType.Application.Json.toString()

class ApiClient(
    val baseUrl: String,
    engine: HttpClientEngine? = null,
    private val tokenStore: TokenStoreInterface,
) {
    private val jsonConfig = Json { ignoreUnknownKeys = true }

    val http: HttpClient = HttpClient(engine ?: OkHttp) {
        install(ContentNegotiation) { json(jsonConfig) }
        install(WebSockets)
        install(Auth) {
            bearer {
                loadTokens {
                    val acc = tokenStore.accessToken
                    val ref = tokenStore.refreshToken
                    if (acc.isNotEmpty()) BearerTokens(acc, ref) else null
                }
                refreshTokens {
                    val resp: RefreshResponse = client.post("$baseUrl/api/auth/refresh") {
                        markAsRefreshTokenRequest()
                        headers { append(HttpHeaders.ContentType, applicationJson) }
                        setBody(mapOf("refreshToken" to tokenStore.refreshToken))
                    }.body()
                    tokenStore.save(resp.accessToken, resp.refreshToken)
                    BearerTokens(resp.accessToken, resp.refreshToken)
                }
            }
        }
        expectSuccess = false
    }

    suspend fun login(username: String, password: String): LoginResponse {
        val resp = http.post("$baseUrl/api/auth/login") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(LoginRequest(username, password))
        }
        if (!resp.status.isSuccess()) error("Login failed: ${resp.status}")
        val body: LoginResponse = resp.body()
        tokenStore.save(body.accessToken, body.refreshToken)
        return body
    }

    suspend fun logout() {
        http.post("$baseUrl/api/auth/logout")
        tokenStore.clear()
    }

    suspend fun getChats(): List<ChatSummaryDto> =
        http.get("$baseUrl/api/chats").body()

    suspend fun registerKeys(req: RegisterKeysRequest) {
        val resp = http.post("$baseUrl/api/keys/register") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("registerKeys failed: ${resp.status}")
    }

    fun wsUrl(token: String): String {
        val wsBase = when {
            baseUrl.startsWith("https://") -> baseUrl.replaceFirst("https://", "wss://")
            baseUrl.startsWith("http://") -> baseUrl.replaceFirst("http://", "ws://")
            else -> baseUrl
        }
        return "$wsBase/ws?token=$token"
    }
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt
git commit -m "feat(android): ApiClient (Ktor OkHttp engine)"
```

---

## Task 10: MessengerWS + WSOrchestrator

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/MessengerWS.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt`

`MessengerWS.kt` копируется без изменений (только пакет). `WSOrchestrator.kt` адаптируется: принимает `db: MessengerDatabase` вместо глобального `DatabaseProvider.database`.

- [ ] **Step 1: Создать `MessengerWS.kt`** — идентично Desktop, только пакет и imports

```kotlin
// src/main/kotlin/com/messenger/service/MessengerWS.kt
package com.messenger.service

import io.ktor.client.*
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.coroutines.coroutineContext
import kotlin.math.min

class MessengerWS(
    private val http: HttpClient,
    private val onFrame: (JsonElement) -> Unit,
    private val onConnect: (send: (String) -> Unit) -> Unit,
    private val onDisconnect: () -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var job: Job? = null

    fun connect(wsUrl: String) {
        job = scope.launch { reconnectLoop(wsUrl) }
    }

    private suspend fun reconnectLoop(wsUrl: String) {
        var attempt = 0
        while (coroutineContext.isActive) {
            try {
                http.webSocket(wsUrl) {
                    attempt = 0
                    var currentSession: DefaultClientWebSocketSession? = this
                    onConnect { msg -> launch { currentSession?.send(msg) } }
                    for (frame in incoming) {
                        if (frame is Frame.Text) {
                            val text = frame.readText()
                            try {
                                val el = Json.parseToJsonElement(text)
                                onFrame(el)
                            } catch (_: Exception) { }
                        }
                    }
                    currentSession = null
                }
            } catch (_: CancellationException) {
                break
            } catch (_: Exception) { }
            onDisconnect()
            val delayMs = min(500L * (1L shl attempt), 60_000L)
            delay(delayMs)
            attempt++
        }
    }

    fun disconnect() { job?.cancel() }
}
```

- [ ] **Step 2: Создать `WSOrchestrator.kt`** — адаптация: принимает `db: MessengerDatabase`

```kotlin
// src/main/kotlin/com/messenger/service/WSOrchestrator.kt
package com.messenger.service

import com.messenger.crypto.Ratchet
import com.messenger.crypto.SenderKey
import com.messenger.db.MessengerDatabase
import com.messenger.store.ChatStore
import kotlinx.serialization.json.*

class WSOrchestrator(
    private val ratchet: Ratchet,
    private val senderKey: SenderKey,
    private val chatStore: ChatStore,
    private val db: MessengerDatabase,
    private val currentUserId: String,
) {
    private val b64Dec = java.util.Base64.getDecoder()

    fun onFrame(frame: JsonElement) {
        val obj = frame.jsonObject
        when (obj["type"]?.jsonPrimitive?.content) {
            "message"          -> handleMessage(obj)
            "ack"              -> handleAck(obj)
            "typing"           -> handleTyping(obj)
            "read"             -> handleRead(obj)
            "message_deleted"  -> handleDeleted(obj)
            "message_edited"   -> handleEdited(obj)
        }
    }

    private fun handleMessage(obj: JsonObject) {
        val chatId      = obj["chatId"]?.jsonPrimitive?.content ?: return
        val senderId    = obj["senderId"]?.jsonPrimitive?.content ?: return
        val ciphertext  = obj["ciphertext"]?.jsonPrimitive?.content ?: return
        val messageId   = obj["messageId"]?.jsonPrimitive?.content ?: return
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: messageId
        val timestamp   = obj["timestamp"]?.jsonPrimitive?.long ?: System.currentTimeMillis()
        val isGroup     = chatStore.isGroup(chatId)

        val plaintext = try {
            val parts = ciphertext.split(":")
            if (parts.size != 2) return
            val nonce = b64Dec.decode(parts[0])
            val ct    = b64Dec.decode(parts[1])
            if (isGroup) {
                val skBlob = db.messengerQueries.loadRatchetSession("sk_$chatId").executeAsOneOrNull() ?: return
                senderKey.decrypt(ct, nonce, skBlob)
            } else {
                val sessionKey = "session_${minOf(senderId, currentUserId)}_${maxOf(senderId, currentUserId)}"
                val chainKey = db.messengerQueries.loadRatchetSession(sessionKey).executeAsOneOrNull() ?: return
                val msgKey = ratchet.deriveMessageKey(chainKey, 0)
                ratchet.decrypt(ct, nonce, msgKey)
            }
        } catch (_: Exception) { return }

        db.messengerQueries.insertMessage(
            id = messageId, client_msg_id = clientMsgId, chat_id = chatId,
            sender_id = senderId, plaintext = String(plaintext),
            timestamp = timestamp, status = "delivered", is_deleted = 0L,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, String(plaintext), senderId, timestamp)
    }

    private fun handleAck(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        db.messengerQueries.updateMessageStatus(status = "sent", client_msg_id = clientMsgId)
        chatStore.onMessageStatusUpdate(clientMsgId, "sent")
    }

    private fun handleTyping(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val userId = obj["userId"]?.jsonPrimitive?.content ?: return
        chatStore.onTyping(chatId, userId)
    }

    private fun handleRead(obj: JsonObject) {
        val chatId    = obj["chatId"]?.jsonPrimitive?.content ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.content ?: return
        chatStore.onRead(chatId, messageId)
    }

    private fun handleDeleted(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        db.messengerQueries.softDeleteMessage(client_msg_id = clientMsgId)
        chatStore.onMessageDeleted(clientMsgId)
    }

    private fun handleEdited(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        val ciphertext  = obj["ciphertext"]?.jsonPrimitive?.content ?: return
        val senderId    = obj["senderId"]?.jsonPrimitive?.content ?: return
        val chatId      = obj["chatId"]?.jsonPrimitive?.content ?: return
        val isGroup     = chatStore.isGroup(chatId)

        val plaintext = try {
            val parts = ciphertext.split(":")
            if (parts.size != 2) return
            val nonce = b64Dec.decode(parts[0])
            val ct    = b64Dec.decode(parts[1])
            if (isGroup) {
                val skBlob = db.messengerQueries.loadRatchetSession("sk_$chatId").executeAsOneOrNull() ?: return
                senderKey.decrypt(ct, nonce, skBlob)
            } else {
                val sessionKey = "session_${minOf(senderId, currentUserId)}_${maxOf(senderId, currentUserId)}"
                val chainKey = db.messengerQueries.loadRatchetSession(sessionKey).executeAsOneOrNull() ?: return
                val msgKey = ratchet.deriveMessageKey(chainKey, 0)
                ratchet.decrypt(ct, nonce, msgKey)
            }
        } catch (_: Exception) { return }

        chatStore.onMessageEdited(clientMsgId, String(plaintext))
    }
}
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/service/MessengerWS.kt apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt
git commit -m "feat(android): MessengerWS + WSOrchestrator"
```

---

## Task 11: Stores

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/store/AuthStore.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt`

Логика идентична Desktop — только пакет меняется с `store` на `com.messenger.store`.

- [ ] **Step 1: Создать `AuthStore.kt`**

```kotlin
// src/main/kotlin/com/messenger/store/AuthStore.kt
package com.messenger.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthStore {
    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    val isAuthenticated: Boolean get() = _state.value.isAuthenticated

    fun login(userId: String, username: String, accessToken: String) {
        _state.value = AuthState(
            isAuthenticated = true,
            userId = userId,
            username = username,
            accessToken = accessToken,
        )
    }

    fun logout() { _state.value = AuthState() }
}
```

- [ ] **Step 2: Создать `ChatStore.kt`**

```kotlin
// src/main/kotlin/com/messenger/store/ChatStore.kt
package com.messenger.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ChatStore {
    private val _chats = MutableStateFlow<List<ChatItem>>(emptyList())
    val chats: StateFlow<List<ChatItem>> = _chats.asStateFlow()

    private val _messages = MutableStateFlow<Map<String, List<MessageItem>>>(emptyMap())
    val messages: StateFlow<Map<String, List<MessageItem>>> = _messages.asStateFlow()

    private val _typing = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<String, Set<String>>> = _typing.asStateFlow()

    fun setChats(list: List<ChatItem>) { _chats.value = list }

    fun isGroup(chatId: String): Boolean =
        _chats.value.find { it.id == chatId }?.isGroup ?: false

    fun onMessageReceived(chatId: String, clientMsgId: String, plaintext: String, senderId: String, timestamp: Long) {
        val msg = MessageItem(
            id = clientMsgId, clientMsgId = clientMsgId, chatId = chatId,
            senderId = senderId, plaintext = plaintext, timestamp = timestamp,
            status = "delivered", isDeleted = false,
        )
        val current = _messages.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptyList()) + msg
        _messages.value = current

        val chats = _chats.value.toMutableList()
        val idx = chats.indexOfFirst { it.id == chatId }
        if (idx >= 0) {
            chats[idx] = chats[idx].copy(lastMessage = plaintext, updatedAt = timestamp)
            _chats.value = chats.sortedByDescending { it.updatedAt }
        }
    }

    fun onMessageStatusUpdate(clientMsgId: String, status: String) {
        _messages.value = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(status = status) else it }
        }
    }

    fun onTyping(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptySet()) + userId
        _typing.value = current
    }

    fun onTypingStop(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        val updated = (current[chatId] ?: emptySet()) - userId
        if (updated.isEmpty()) current.remove(chatId) else current[chatId] = updated
        _typing.value = current
    }

    fun onRead(chatId: String, messageId: String) { onMessageStatusUpdate(messageId, "read") }

    fun onMessageDeleted(clientMsgId: String) {
        _messages.value = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(isDeleted = true) else it }
                .filter { !it.isDeleted }
        }
    }

    fun onMessageEdited(clientMsgId: String, newPlaintext: String) {
        _messages.value = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(plaintext = newPlaintext) else it }
        }
    }

    fun setMessages(chatId: String, msgs: List<MessageItem>) {
        val current = _messages.value.toMutableMap()
        current[chatId] = msgs
        _messages.value = current
    }
}
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/store/
git commit -m "feat(android): AuthStore + ChatStore (StateFlow)"
```

---

## Task 12: ViewModels

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatListViewModel.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt`

Ключевые отличия от Desktop: `AndroidViewModel(application)`, `viewModelScope`, `DatabaseProvider` как класс-инстанс, `LazySodiumAndroid`.

- [ ] **Step 1: Создать `AppViewModel.kt`**

```kotlin
// src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.messenger.config.ServerConfig
import com.messenger.crypto.KeyStorage
import com.messenger.crypto.Ratchet
import com.messenger.crypto.SenderKey
import com.messenger.db.DatabaseProvider
import com.messenger.service.ApiClient
import com.messenger.service.MessengerWS
import com.messenger.service.WSOrchestrator
import com.messenger.service.TokenStore
import com.messenger.store.AuthState
import com.messenger.store.AuthStore
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AppViewModel(application: Application) : AndroidViewModel(application) {
    val authStore = AuthStore()
    val chatStore = ChatStore()
    val authState: StateFlow<AuthState> = authStore.state

    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val ratchet = Ratchet(sodium)
    private val senderKey = SenderKey(sodium)

    private val tokenStore = TokenStore(application)
    val keyStorage = KeyStorage(application)
    val dbProvider = DatabaseProvider(application)

    var apiClient: ApiClient? = null
    private var ws: MessengerWS? = null
    @Volatile private var wsSend: ((String) -> Unit)? = null

    fun setServerUrl(url: String) {
        ServerConfig.serverUrl = url
        apiClient = ApiClient(baseUrl = url, tokenStore = tokenStore)
    }

    suspend fun login(username: String, password: String): Result<Unit> {
        val client = apiClient ?: return Result.failure(IllegalStateException("Server URL not set"))
        return try {
            val resp = client.login(username, password)
            authStore.login(userId = username, username = username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        ws?.disconnect()
        ws = null
        apiClient?.logout()
        authStore.logout()
    }

    private fun startWS(token: String) {
        val client = apiClient ?: return
        val db = dbProvider.database
        val orchestrator = WSOrchestrator(
            ratchet = ratchet,
            senderKey = senderKey,
            chatStore = chatStore,
            db = db,
            currentUserId = authStore.state.value.userId,
        )
        val wsInstance = MessengerWS(
            http = client.http,
            onFrame = { frame -> orchestrator.onFrame(frame) },
            onConnect = { send ->
                wsSend = send
                viewModelScope.launch {
                    db.messengerQueries.getAllOutbox().executeAsList().forEach { item ->
                        send(item.plaintext)
                        db.messengerQueries.deleteOutbox(item.client_msg_id)
                    }
                }
            },
            onDisconnect = { },
        )
        wsInstance.connect(client.wsUrl(token))
        ws = wsInstance
    }

    fun sendMessage(chatId: String, plaintext: String) {
        val userId = authStore.state.value.userId
        val clientMsgId = java.util.UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val db = dbProvider.database

        db.messengerQueries.insertMessage(
            id = clientMsgId, client_msg_id = clientMsgId, chat_id = chatId,
            sender_id = userId, plaintext = plaintext, timestamp = timestamp,
            status = "sending", is_deleted = 0L,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, plaintext, userId, timestamp)

        val frame = kotlinx.serialization.json.buildJsonObject {
            put("type", kotlinx.serialization.json.JsonPrimitive("message"))
            put("chatId", kotlinx.serialization.json.JsonPrimitive(chatId))
            put("clientMsgId", kotlinx.serialization.json.JsonPrimitive(clientMsgId))
            put("plaintext", kotlinx.serialization.json.JsonPrimitive(plaintext))
        }.toString()

        val send = wsSend
        if (send != null) {
            send(frame)
        } else {
            db.messengerQueries.insertOutbox(
                client_msg_id = clientMsgId, chat_id = chatId,
                plaintext = frame, created_at = timestamp,
            )
        }
    }

    private suspend fun loadChats() {
        val client = apiClient ?: return
        try {
            val dtos = client.getChats()
            chatStore.setChats(dtos.map { dto ->
                ChatItem(id = dto.id, name = dto.name, isGroup = dto.isGroup,
                    lastMessage = null, updatedAt = dto.updatedAt)
            })
        } catch (_: Exception) { }
    }
}
```

- [ ] **Step 2: Создать `ChatListViewModel.kt`**

```kotlin
// src/main/kotlin/com/messenger/viewmodel/ChatListViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.coroutines.flow.StateFlow

class ChatListViewModel(
    application: Application,
    private val chatStore: ChatStore,
) : AndroidViewModel(application) {
    val chats: StateFlow<List<ChatItem>> = chatStore.chats
}
```

- [ ] **Step 3: Создать `ChatWindowViewModel.kt`**

```kotlin
// src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.messenger.db.MessengerDatabase
import com.messenger.store.ChatStore
import com.messenger.store.MessageItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ChatWindowViewModel(
    application: Application,
    val chatId: String,
    private val chatStore: ChatStore,
    private val db: MessengerDatabase,
    private val currentUserId: String,
) : AndroidViewModel(application) {
    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val rows = db.messengerQueries.getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id, clientMsgId = row.client_msg_id, chatId = row.chat_id,
                    senderId = row.sender_id, plaintext = row.plaintext,
                    timestamp = row.timestamp, status = row.status, isDeleted = row.is_deleted != 0L,
                )
            }
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        viewModelScope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        viewModelScope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }
}
```

- [ ] **Step 4: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/
git commit -m "feat(android): AppViewModel + ChatListViewModel + ChatWindowViewModel"
```

---

## Task 13: UI компоненты

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/components/MessageBubble.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/components/TypingIndicator.kt`

Копируются без изменений — только пакет.

- [ ] **Step 1: Создать `MessageBubble.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/components/MessageBubble.kt
package com.messenger.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.messenger.store.MessageItem
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun MessageBubble(message: MessageItem, isOwn: Boolean) {
    val bubbleColor = if (isOwn)
        MaterialTheme.colorScheme.primaryContainer
    else
        MaterialTheme.colorScheme.surfaceVariant

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isOwn) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalAlignment = if (isOwn) Alignment.End else Alignment.Start,
        ) {
            Text(text = message.plaintext, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(2.dp))
            Text(
                text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp)),
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}
```

- [ ] **Step 2: Создать `TypingIndicator.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/components/TypingIndicator.kt
package com.messenger.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun TypingIndicator(users: Set<String>) {
    if (users.isEmpty()) return
    val text = if (users.size == 1) "${users.first()} печатает..."
               else "${users.joinToString(", ")} печатают..."
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
}
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/components/
git commit -m "feat(android): MessageBubble + TypingIndicator"
```

---

## Task 14: Экраны

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ServerSetupScreen.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/AuthScreen.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatListScreen.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ProfileScreen.kt`

Экраны копируются из Desktop с заменой пакетов. Compose API одинаковый.

- [ ] **Step 1: Создать `ServerSetupScreen.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/screens/ServerSetupScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ServerSetupScreen(onServerSet: (String) -> Unit) {
    var url by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Настройка сервера", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = url,
            onValueChange = { url = it; error = "" },
            label = { Text("URL сервера (например https://messenger.example.com)") },
            modifier = Modifier.fillMaxWidth(),
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                val trimmed = url.trim()
                if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                    onServerSet(trimmed)
                } else {
                    error = "URL должен начинаться с http:// или https://"
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Подключиться") }
    }
}
```

- [ ] **Step 2: Создать `AuthScreen.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/screens/AuthScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    serverUrl: String,
    onLogin: suspend (username: String, password: String) -> Result<Unit>,
    onChangeServer: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Вход", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        TextButton(onClick = onChangeServer) { Text("Изменить сервер") }
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = username, onValueChange = { username = it; error = "" },
            label = { Text("Имя пользователя") }, modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it; error = "" },
            label = { Text("Пароль") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (username.isBlank() || password.isBlank()) { error = "Введите логин и пароль"; return@Button }
                loading = true
                scope.launch {
                    val result = onLogin(username, password)
                    loading = false
                    result.onFailure { e -> error = e.message ?: "Ошибка входа" }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !loading,
        ) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text("Войти")
        }
    }
}
```

- [ ] **Step 3: Создать `ChatListScreen.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/screens/ChatListScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.messenger.store.ChatItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    chats: List<ChatItem>,
    onChatClick: (String) -> Unit,
    onProfileClick: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Чаты") },
                actions = { TextButton(onClick = onProfileClick) { Text("Профиль") } },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding)) {
            items(chats, key = { it.id }) { chat ->
                ListItem(
                    headlineContent = { Text(chat.name) },
                    supportingContent = { chat.lastMessage?.let { Text(it, maxLines = 1) } },
                    modifier = Modifier.clickable { onChatClick(chat.id) },
                )
                HorizontalDivider()
            }
        }
    }
}
```

- [ ] **Step 4: Создать `ChatWindowScreen.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.messenger.store.MessageItem
import com.messenger.ui.components.MessageBubble
import com.messenger.ui.components.TypingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatWindowScreen(
    chatName: String,
    messages: List<MessageItem>,
    typingUsers: Set<String>,
    currentUserId: String,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(chatName) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(messages, key = { it.clientMsgId }) { msg ->
                    MessageBubble(message = msg, isOwn = msg.senderId == currentUserId)
                }
            }
            TypingIndicator(typingUsers)
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Сообщение...") },
                    maxLines = 4,
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = { if (text.isNotBlank()) { onSend(text.trim()); text = "" } },
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Отправить")
                }
            }
        }
    }
}
```

- [ ] **Step 5: Создать `ProfileScreen.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/screens/ProfileScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    username: String,
    serverUrl: String,
    onBack: () -> Unit,
    onLogout: suspend () -> Unit,
    onChangeServer: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Профиль") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(username, style = MaterialTheme.typography.titleLarge)
            Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onChangeServer, modifier = Modifier.fillMaxWidth()) {
                Text("Изменить сервер")
            }
            Button(
                onClick = { scope.launch { onLogout() } },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text("Выйти") }
        }
    }
}
```

- [ ] **Step 6: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/
git commit -m "feat(android): все экраны — ServerSetup, Auth, ChatList, ChatWindow, Profile"
```

---

## Task 15: App.kt + MainActivity.kt

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/MainActivity.kt`

`App.kt` принимает `application: Application` для создания `AppViewModel`. `MainActivity` — точка входа.

- [ ] **Step 1: Создать `App.kt`**

```kotlin
// src/main/kotlin/com/messenger/ui/App.kt
package com.messenger.ui

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.lifecycle.viewmodel.compose.viewModel
import com.messenger.config.ServerConfig
import com.messenger.ui.screens.*
import com.messenger.viewmodel.AppViewModel
import com.messenger.viewmodel.ChatListViewModel
import com.messenger.viewmodel.ChatWindowViewModel
import kotlinx.coroutines.launch

sealed class Screen {
    object ServerSetup : Screen()
    object Auth : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
}

@Composable
fun App(application: Application) {
    val vm: AppViewModel = viewModel(
        factory = androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.getInstance(application)
    )
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val scope = rememberCoroutineScope()

    var screen by remember {
        mutableStateOf<Screen>(
            if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
        )
    }

    MaterialTheme {
        when (val s = screen) {
            Screen.ServerSetup -> ServerSetupScreen(
                onServerSet = { url -> vm.setServerUrl(url); screen = Screen.Auth },
            )
            Screen.Auth -> {
                LaunchedEffect(authState.isAuthenticated) {
                    if (authState.isAuthenticated) screen = Screen.ChatList
                }
                AuthScreen(
                    serverUrl = ServerConfig.serverUrl,
                    onLogin = { username, password -> vm.login(username, password) },
                    onChangeServer = { screen = Screen.ServerSetup },
                )
            }
            Screen.ChatList -> {
                val clVm: ChatListViewModel = viewModel(
                    factory = androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.getInstance(application)
                )
                val chatList by clVm.chats.collectAsState()
                ChatListScreen(
                    chats = chatList,
                    onChatClick = { chatId -> screen = Screen.ChatWindow(chatId) },
                    onProfileClick = { screen = Screen.Profile },
                )
            }
            is Screen.ChatWindow -> {
                val chatId = s.chatId
                val chatName = chats.find { it.id == chatId }?.name ?: chatId
                val cwVm = remember(chatId) {
                    ChatWindowViewModel(
                        application = application,
                        chatId = chatId,
                        chatStore = vm.chatStore,
                        db = vm.dbProvider.database,
                        currentUserId = authState.userId,
                    )
                }
                val messages by cwVm.messages.collectAsState()
                val typingUsers by cwVm.typingUsers.collectAsState()
                ChatWindowScreen(
                    chatName = chatName,
                    messages = messages,
                    typingUsers = typingUsers,
                    currentUserId = authState.userId,
                    onBack = { screen = Screen.ChatList },
                    onSend = { text -> vm.sendMessage(chatId, text) },
                )
            }
            Screen.Profile -> ProfileScreen(
                username = authState.username,
                serverUrl = ServerConfig.serverUrl,
                onBack = { screen = Screen.ChatList },
                onLogout = { scope.launch { vm.logout(); screen = Screen.Auth } },
                onChangeServer = { screen = Screen.ServerSetup },
            )
        }
    }
}
```

- [ ] **Step 2: Создать `MainActivity.kt`**

```kotlin
// src/main/kotlin/com/messenger/MainActivity.kt
package com.messenger

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.messenger.ui.App

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { App(application) }
    }
}
```

- [ ] **Step 3: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt apps/mobile/android/src/main/kotlin/com/messenger/MainActivity.kt
git commit -m "feat(android): App.kt + MainActivity — точка входа"
```

---

## Task 16: FcmService stub

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/push/FcmService.kt`

FCM-интеграция на стороне сервера — вне scope MVP. Добавляем stub, не подключая Firebase Gradle plugin (чтобы не требовать `google-services.json`).

- [ ] **Step 1: Создать `FcmService.kt`**

```kotlin
// src/main/kotlin/com/messenger/push/FcmService.kt
package com.messenger.push

// FCM stub — Firebase integration is out of scope for MVP.
// To enable:
// 1. Add google-services plugin to build.gradle.kts
// 2. Add google-services.json to project root
// 3. Uncomment FirebaseMessagingService implementation below
// 4. Register this service in AndroidManifest.xml with MESSAGING_EVENT intent-filter

/*
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // TODO: send FCM token to server via ApiClient
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // TODO: show notification when app is in background
    }
}
*/
```

- [ ] **Step 2: Коммит**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/push/FcmService.kt
git commit -m "feat(android): FcmService stub (FCM вне scope MVP)"
```

---

## Task 17: Сборка и верификация

**Files:** нет новых файлов

- [ ] **Step 1: Запустить unit-тесты**

```bash
cd apps/mobile/android
./gradlew test
```

Ожидается: `BUILD SUCCESSFUL`, 4 теста зелёных (X3DHTest ×1, RatchetTest ×3).

- [ ] **Step 2: Собрать debug APK**

```bash
./gradlew assembleDebug
```

Ожидается: `BUILD SUCCESSFUL`, файл `build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 3: Проверить что Desktop тесты не сломались**

```bash
cd ../../desktop
./gradlew test
```

Ожидается: `BUILD SUCCESSFUL` — Desktop не затронут.

- [ ] **Step 4: Обновить `docs/spec-gap-checklist.md`**

В секции `### 11C-2 Android` отметить как ✅ выполненные:
- `[x] Gradle scaffold + Compose Activity + Manifest`
- `[x] Crypto адаптеры (lazysodium-android)`
- `[x] ApiClient + MessengerWS (Ktor Android engine)`
- `[x] SQLDelight или Room база данных`
- `[x] UI экраны (Jetpack Compose)`

FCM Push notifications остаётся `[ ]`.

- [ ] **Step 5: Финальный коммит**

```bash
cd /path/to/messenger/root
git add docs/spec-gap-checklist.md
git commit -m "docs: отметить 11C-2 Android MVP как выполненный"
```
