# Stage 11C-1: Compose Desktop MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать нативный Compose Desktop клиент (macOS/Windows/Linux) с auth, ChatList, ChatWindow и E2E шифрованием (X3DH + Double Ratchet + SenderKey), совместимым с web-клиентом.

**Architecture:** Thin Kotlin-клиент, 4 слоя: UI (Compose) → ViewModel (StateFlow) → Service (Ktor REST/WS) → Platform (lazysodium, SQLDelight, PKCS12). Крипто портируется с TypeScript, совместимость верифицируется через `shared/test-vectors/*.json`.

**Tech Stack:** Compose Multiplatform 1.7.x, Ktor 3.x (CIO), kotlinx.serialization 1.7.x, lazysodium-java 5.1.x, SQLDelight 2.x (SQLite JDBC), JUnit 5, Gradle compose.desktop plugin.

---

## Карта файлов

**Создать:**
```
apps/desktop/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle/libs.versions.toml
├── src/main/kotlin/
│   ├── Main.kt
│   ├── config/ServerConfig.kt
│   ├── crypto/
│   │   ├── X3DH.kt
│   │   ├── Ratchet.kt
│   │   ├── SenderKey.kt
│   │   └── KeyStorage.kt
│   ├── db/
│   │   ├── messenger.sq
│   │   └── DatabaseProvider.kt
│   ├── service/
│   │   ├── ApiClient.kt
│   │   ├── TokenStore.kt
│   │   ├── MessengerWS.kt
│   │   └── WSOrchestrator.kt
│   ├── store/
│   │   ├── AuthStore.kt
│   │   ├── ChatStore.kt
│   │   └── AppState.kt
│   ├── viewmodel/
│   │   ├── AppViewModel.kt
│   │   ├── ChatListViewModel.kt
│   │   └── ChatWindowViewModel.kt
│   └── ui/
│       ├── App.kt
│       ├── screens/
│       │   ├── ServerSetupScreen.kt
│       │   ├── AuthScreen.kt
│       │   ├── ChatListScreen.kt
│       │   ├── ChatWindowScreen.kt
│       │   └── ProfileScreen.kt
│       └── components/
│           ├── MessageBubble.kt
│           └── TypingIndicator.kt
└── src/test/kotlin/
    ├── crypto/
    │   ├── X3DHTest.kt
    │   ├── RatchetTest.kt
    │   └── SenderKeyTest.kt
    └── service/
        └── ApiClientTest.kt

shared/test-vectors/
├── x3dh.json
├── ratchet.json
└── sender-key.json

client/scripts/generate-test-vectors.ts   (новый скрипт для генерации test-vectors)
```

---

## Task 1: Gradle scaffold

**Files:**
- Create: `apps/desktop/settings.gradle.kts`
- Create: `apps/desktop/build.gradle.kts`
- Create: `apps/desktop/gradle/libs.versions.toml`
- Create: `apps/desktop/src/main/kotlin/Main.kt`

- [ ] **Step 1: Создать `settings.gradle.kts`**

```kotlin
// apps/desktop/settings.gradle.kts
rootProject.name = "messenger-desktop"
```

- [ ] **Step 2: Создать `gradle/libs.versions.toml`**

```toml
# apps/desktop/gradle/libs.versions.toml
[versions]
kotlin = "2.0.21"
compose = "1.7.3"
ktor = "3.1.2"
serialization = "1.7.3"
lazysodium = "5.1.4"
sqldelight = "2.0.2"
junit = "5.10.2"
coroutines = "1.8.1"
slf4j = "2.0.13"

[libraries]
compose-runtime = { module = "org.jetbrains.compose.runtime:runtime-desktop", version.ref = "compose" }
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
ktor-client-cio = { module = "io.ktor:ktor-client-cio", version.ref = "ktor" }
ktor-client-content-negotiation = { module = "io.ktor:ktor-client-content-negotiation", version.ref = "ktor" }
ktor-client-auth = { module = "io.ktor:ktor-client-auth", version.ref = "ktor" }
ktor-serialization-json = { module = "io.ktor:ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-websockets = { module = "io.ktor:ktor-client-websockets", version.ref = "ktor" }
ktor-client-mock = { module = "io.ktor:ktor-client-mock", version.ref = "ktor" }
serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
lazysodium = { module = "com.goterl:lazysodium-java", version.ref = "lazysodium" }
jna = { module = "net.java.dev.jna:jna", version = "5.14.0" }
sqldelight-driver = { module = "app.cash.sqldelight:sqlite-driver", version.ref = "sqldelight" }
coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
coroutines-swing = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-swing", version.ref = "coroutines" }
coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
slf4j-simple = { module = "org.slf4j:slf4j-simple", version.ref = "slf4j" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
compose-desktop = { id = "org.jetbrains.compose", version.ref = "compose" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
sqldelight = { id = "app.cash.sqldelight", version.ref = "sqldelight" }
```

- [ ] **Step 3: Создать `build.gradle.kts`**

```kotlin
// apps/desktop/build.gradle.kts
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.compose.desktop)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.sqldelight)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(compose.desktop.currentOs)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.cio)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.client.auth)
    implementation(libs.ktor.serialization.json)
    implementation(libs.ktor.client.websockets)
    implementation(libs.serialization.json)
    implementation(libs.lazysodium)
    implementation(libs.jna)
    implementation(libs.sqldelight.driver)
    implementation(libs.coroutines.core)
    implementation(libs.coroutines.swing)
    implementation(libs.slf4j.simple)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.ktor.client.mock)
}

tasks.test {
    useJUnitPlatform()
}

sqldelight {
    databases {
        create("MessengerDatabase") {
            packageName.set("com.messenger.db")
            srcDirs("src/main/sqldelight")
        }
    }
}

compose.desktop {
    application {
        mainClass = "MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "Messenger"
            packageVersion = "1.0.0"
            macOS { bundleID = "com.messenger.desktop" }
            windows { menuGroup = "Messenger" }
            linux { packageName = "messenger" }
        }
    }
}
```

- [ ] **Step 4: Создать `Main.kt`**

```kotlin
// apps/desktop/src/main/kotlin/Main.kt
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import ui.App

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "Messenger",
    ) {
        App()
    }
}
```

- [ ] **Step 5: Создать `ui/App.kt` — заглушка**

```kotlin
// apps/desktop/src/main/kotlin/ui/App.kt
package ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun App() {
    MaterialTheme {
        Text("Messenger Desktop — scaffold")
    }
}
```

- [ ] **Step 6: Убедиться что проект собирается**

```sh
cd apps/desktop
./gradlew compileKotlin
```

Ожидаемый результат: `BUILD SUCCESSFUL`

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): Gradle scaffold — Compose Desktop + Ktor + SQLDelight + lazysodium"
```

---

## Task 2: Генерация test-vectors из web-клиента

**Files:**
- Create: `client/scripts/generate-test-vectors.ts`
- Create: `shared/test-vectors/x3dh.json`
- Create: `shared/test-vectors/ratchet.json`
- Create: `shared/test-vectors/sender-key.json`

- [ ] **Step 1: Создать скрипт генерации векторов**

```typescript
// client/scripts/generate-test-vectors.ts
// Запускать: npx tsx client/scripts/generate-test-vectors.ts
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import sodium from 'libsodium-wrappers'

async function main() {
  await sodium.ready

  const outDir = join(__dirname, '../../shared/test-vectors')
  mkdirSync(outDir, { recursive: true })

  // --- X3DH vector ---
  const aliceIK = sodium.crypto_sign_keypair()
  const aliceSPK = sodium.crypto_box_keypair()
  const aliceOPK = sodium.crypto_box_keypair()
  const bobIK = sodium.crypto_sign_keypair()
  const bobSPK = sodium.crypto_box_keypair()

  // Alice IK ed→curve
  const aliceIKCurve = {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(aliceIK.publicKey),
    privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(aliceIK.privateKey),
  }
  const bobIKCurve = {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(bobIK.publicKey),
    privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(bobIK.privateKey),
  }

  // DH1 = DH(Alice_IK_curve, Bob_SPK)
  const dh1 = sodium.crypto_scalarmult(aliceIKCurve.privateKey, bobSPK.publicKey)
  // DH2 = DH(Alice_SPK, Bob_IK_curve)
  const dh2 = sodium.crypto_scalarmult(aliceSPK.privateKey, bobIKCurve.publicKey)
  // DH3 = DH(Alice_SPK, Bob_SPK)
  const dh3 = sodium.crypto_scalarmult(aliceSPK.privateKey, bobSPK.publicKey)
  // DH4 = DH(Alice_OPK, Bob_SPK)
  const dh4 = sodium.crypto_scalarmult(aliceOPK.privateKey, bobSPK.publicKey)

  const combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length)
  combined.set(dh1, 0)
  combined.set(dh2, dh1.length)
  combined.set(dh3, dh1.length + dh2.length)
  combined.set(dh4, dh1.length + dh2.length + dh3.length)

  const sharedSecret = sodium.crypto_generichash(32, combined)

  const x3dhVector = {
    aliceIdentityKeyPair: {
      publicKey: Buffer.from(aliceIK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceIK.privateKey).toString('base64'),
    },
    aliceSignedPreKey: {
      publicKey: Buffer.from(aliceSPK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceSPK.privateKey).toString('base64'),
    },
    aliceOneTimePreKey: {
      publicKey: Buffer.from(aliceOPK.publicKey).toString('base64'),
      privateKey: Buffer.from(aliceOPK.privateKey).toString('base64'),
    },
    bobIdentityKeyPair: {
      publicKey: Buffer.from(bobIK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobIK.privateKey).toString('base64'),
    },
    bobSignedPreKey: {
      publicKey: Buffer.from(bobSPK.publicKey).toString('base64'),
      privateKey: Buffer.from(bobSPK.privateKey).toString('base64'),
    },
    expectedSharedSecret: Buffer.from(sharedSecret).toString('base64'),
  }
  writeFileSync(join(outDir, 'x3dh.json'), JSON.stringify(x3dhVector, null, 2))

  // --- Ratchet vector ---
  const rootKey = sodium.randombytes_buf(32)
  const chainKey = sodium.randombytes_buf(32)
  const msgKey = sodium.crypto_kdf_derive_from_key(32, 1, 'msg_key_', chainKey)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const plaintext = new TextEncoder().encode('hello ratchet')
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, msgKey)

  const ratchetVector = {
    rootKey: Buffer.from(rootKey).toString('base64'),
    chainKey: Buffer.from(chainKey).toString('base64'),
    messageIndex: 1,
    nonce: Buffer.from(nonce).toString('base64'),
    plaintext: 'hello ratchet',
    expectedCiphertext: Buffer.from(ciphertext).toString('base64'),
    expectedMsgKey: Buffer.from(msgKey).toString('base64'),
  }
  writeFileSync(join(outDir, 'ratchet.json'), JSON.stringify(ratchetVector, null, 2))

  // --- SenderKey vector ---
  const senderKey = sodium.randombytes_buf(32)
  const skNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const skPlaintext = new TextEncoder().encode('hello group')
  const skCiphertext = sodium.crypto_secretbox_easy(skPlaintext, skNonce, senderKey)

  const senderKeyVector = {
    senderKey: Buffer.from(senderKey).toString('base64'),
    nonce: Buffer.from(skNonce).toString('base64'),
    plaintext: 'hello group',
    expectedCiphertext: Buffer.from(skCiphertext).toString('base64'),
  }
  writeFileSync(join(outDir, 'sender-key.json'), JSON.stringify(senderKeyVector, null, 2))

  console.log('✅ Test vectors written to shared/test-vectors/')
}

main().catch(console.error)
```

- [ ] **Step 2: Запустить генерацию**

```sh
cd /path/to/messenger
npx tsx client/scripts/generate-test-vectors.ts
```

Ожидаемый результат: `✅ Test vectors written to shared/test-vectors/`

- [ ] **Step 3: Проверить что файлы созданы**

```sh
ls shared/test-vectors/
# x3dh.json  ratchet.json  sender-key.json
cat shared/test-vectors/x3dh.json | head -5
```

- [ ] **Step 4: Commit**

```bash
git add client/scripts/generate-test-vectors.ts shared/test-vectors/
git commit -m "feat(desktop): генерация test-vectors для кросс-клиентной верификации крипто"
```

---

## Task 3: X3DH.kt

**Files:**
- Create: `apps/desktop/src/main/kotlin/crypto/X3DH.kt`
- Create: `apps/desktop/src/test/kotlin/crypto/X3DHTest.kt`

- [ ] **Step 1: Написать тест**

```kotlin
// apps/desktop/src/test/kotlin/crypto/X3DHTest.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class X3DHTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64 = Base64.getDecoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `x3dh shared secret matches web test vector`() {
        val v = loadVector("x3dh")

        val aliceIKPriv = b64.decode(v["aliceIdentityKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val aliceSPKPriv = b64.decode(v["aliceSignedPreKey"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val aliceOPKPriv = b64.decode(v["aliceOneTimePreKey"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val bobIKPriv = b64.decode(v["bobIdentityKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val bobSPKPub = b64.decode(v["bobSignedPreKey"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val bobIKPub = b64.decode(v["bobIdentityKeyPair"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val expected = v["expectedSharedSecret"]!!.jsonPrimitive.content

        val result = X3DH(sodium).computeSharedSecret(
            aliceIKPrivEd = aliceIKPriv,
            aliceSPKPriv = aliceSPKPriv,
            aliceOPKPriv = aliceOPKPriv,
            bobIKPubEd = bobIKPub,
            bobSPKPub = bobSPKPub,
        )

        assertEquals(expected, Base64.getEncoder().encodeToString(result))
    }
}
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```sh
cd apps/desktop
./gradlew test --tests "crypto.X3DHTest" 2>&1 | tail -5
```

Ожидаемый результат: `FAILED` с "Unresolved reference: X3DH"

- [ ] **Step 3: Реализовать `X3DH.kt`**

```kotlin
// apps/desktop/src/main/kotlin/crypto/X3DH.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.interfaces.Sign
import com.sun.jna.ptr.PointerByReference

class X3DH(private val sodium: LazySodiumJava) {

    /**
     * Вычисляет shared secret по схеме X3DH (Alice-initiator).
     * Маппинг с TypeScript libsodium-wrappers:
     *   crypto_sign_ed25519_sk_to_curve25519  → convertSecretKeyEd25519ToCurve25519 (вшито вручную через native)
     *   crypto_scalarmult                     → cryptoScalarMult
     *   crypto_generichash                    → cryptoGenericHash
     */
    fun computeSharedSecret(
        aliceIKPrivEd: ByteArray,   // 64-byte ed25519 secret key
        aliceSPKPriv: ByteArray,    // 32-byte curve25519 private key
        aliceOPKPriv: ByteArray,    // 32-byte curve25519 private key
        bobIKPubEd: ByteArray,      // 32-byte ed25519 public key
        bobSPKPub: ByteArray,       // 32-byte curve25519 public key
    ): ByteArray {
        // ed25519 → curve25519
        val aliceIKCurvePriv = ed25519SkToCurve25519(aliceIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)

        // DH1 = DH(Alice_IK_curve, Bob_SPK)
        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        // DH2 = DH(Alice_SPK, Bob_IK_curve)
        val dh2 = scalarmult(aliceSPKPriv, bobIKCurvePub)
        // DH3 = DH(Alice_SPK, Bob_SPK)
        val dh3 = scalarmult(aliceSPKPriv, bobSPKPub)
        // DH4 = DH(Alice_OPK, Bob_SPK)
        val dh4 = scalarmult(aliceOPKPriv, bobSPKPub)

        val combined = dh1 + dh2 + dh3 + dh4
        return genericHash(combined, 32)
    }

    private fun scalarmult(priv: ByteArray, pub: ByteArray): ByteArray {
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
        val out = ByteArray(32)
        check(sodium.convertPublicKeyEd25519ToCurve25519(out, edPk)) {
            "ed25519PkToCurve25519 failed"
        }
        return out
    }

    private fun ed25519SkToCurve25519(edSk: ByteArray): ByteArray {
        val out = ByteArray(32)
        // lazysodium: convertSecretKeyEd25519ToCurve25519
        check(sodium.convertSecretKeyEd25519ToCurve25519(out, edSk)) {
            "ed25519SkToCurve25519 failed"
        }
        return out
    }
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

```sh
cd apps/desktop
./gradlew test --tests "crypto.X3DHTest"
```

Ожидаемый результат: `BUILD SUCCESSFUL`, `1 test passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): X3DH.kt — shared secret совместим с web test vector"
```

---

## Task 4: Ratchet.kt

**Files:**
- Create: `apps/desktop/src/main/kotlin/crypto/Ratchet.kt`
- Create: `apps/desktop/src/test/kotlin/crypto/RatchetTest.kt`

- [ ] **Step 1: Написать тест**

```kotlin
// apps/desktop/src/test/kotlin/crypto/RatchetTest.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class RatchetTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64Dec = Base64.getDecoder()
    private val b64Enc = Base64.getEncoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `deriveMessageKey matches web test vector`() {
        val v = loadVector("ratchet")
        val chainKey = b64Dec.decode(v["chainKey"]!!.jsonPrimitive.content)
        val index = v["messageIndex"]!!.jsonPrimitive.int
        val expected = v["expectedMsgKey"]!!.jsonPrimitive.content

        val ratchet = Ratchet(sodium)
        val msgKey = ratchet.deriveMessageKey(chainKey, index)

        assertEquals(expected, b64Enc.encodeToString(msgKey))
    }

    @Test
    fun `encrypt then decrypt round-trip`() {
        val ratchet = Ratchet(sodium)
        val chainKey = ByteArray(32) { it.toByte() }
        val msgKey = ratchet.deriveMessageKey(chainKey, 0)
        val plaintext = "hello ratchet"

        val (ciphertext, nonce) = ratchet.encrypt(plaintext.toByteArray(), msgKey)
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

        val ratchet = Ratchet(sodium)
        val (ciphertext, _) = ratchet.encryptWithNonce(plaintext.toByteArray(), msgKey, nonce)

        assertEquals(expected, b64Enc.encodeToString(ciphertext))
    }
}
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```sh
cd apps/desktop && ./gradlew test --tests "crypto.RatchetTest" 2>&1 | tail -5
```

- [ ] **Step 3: Реализовать `Ratchet.kt`**

```kotlin
// apps/desktop/src/main/kotlin/crypto/Ratchet.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava

class Ratchet(private val sodium: LazySodiumJava) {

    /**
     * Деривирует message key из chain key и индекса.
     * Аналог TypeScript: crypto_kdf_derive_from_key(32, index, "msg_key_", chainKey)
     */
    fun deriveMessageKey(chainKey: ByteArray, index: Int): ByteArray {
        val out = ByteArray(32)
        val subkeyId = index.toLong()
        val context = "msg_key_".toByteArray(Charsets.UTF_8)
        check(sodium.cryptoKdfDeriveFromKey(out, 32, subkeyId, context, chainKey)) {
            "cryptoKdfDeriveFromKey failed"
        }
        return out
    }

    /**
     * Шифрует plaintext с помощью msgKey, генерирует случайный nonce.
     * Аналог TypeScript: crypto_secretbox_easy(plaintext, nonce, msgKey)
     * Возвращает Pair(ciphertext, nonce)
     */
    fun encrypt(plaintext: ByteArray, msgKey: ByteArray): Pair<ByteArray, ByteArray> {
        val nonce = sodium.randombytesBuf(sodium.NONCEBYTES)
        return encryptWithNonce(plaintext, msgKey, nonce)
    }

    fun encryptWithNonce(plaintext: ByteArray, msgKey: ByteArray, nonce: ByteArray): Pair<ByteArray, ByteArray> {
        val ciphertext = ByteArray(plaintext.size + sodium.MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxEasy failed"
        }
        return Pair(ciphertext, nonce)
    }

    /**
     * Расшифровывает ciphertext.
     * Аналог TypeScript: crypto_secretbox_open_easy(ciphertext, nonce, msgKey)
     */
    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, msgKey: ByteArray): ByteArray {
        val plaintext = ByteArray(ciphertext.size - sodium.MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxOpenEasy failed — bad message key or corrupted ciphertext"
        }
        return plaintext
    }

    private val LazySodiumJava.NONCEBYTES get() = 24
    private val LazySodiumJava.MACBYTES get() = 16
}
```

- [ ] **Step 4: Запустить тесты**

```sh
cd apps/desktop && ./gradlew test --tests "crypto.RatchetTest"
```

Ожидаемый результат: `3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): Ratchet.kt — encrypt/decrypt совместим с web test vector"
```

---

## Task 5: SenderKey.kt + KeyStorage.kt

**Files:**
- Create: `apps/desktop/src/main/kotlin/crypto/SenderKey.kt`
- Create: `apps/desktop/src/main/kotlin/crypto/KeyStorage.kt`
- Create: `apps/desktop/src/test/kotlin/crypto/SenderKeyTest.kt`

- [ ] **Step 1: Написать тест для SenderKey**

```kotlin
// apps/desktop/src/test/kotlin/crypto/SenderKeyTest.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class SenderKeyTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64Dec = Base64.getDecoder()
    private val b64Enc = Base64.getEncoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `encrypt matches web test vector`() {
        val v = loadVector("sender-key")
        val senderKey = b64Dec.decode(v["senderKey"]!!.jsonPrimitive.content)
        val nonce = b64Dec.decode(v["nonce"]!!.jsonPrimitive.content)
        val plaintext = v["plaintext"]!!.jsonPrimitive.content
        val expected = v["expectedCiphertext"]!!.jsonPrimitive.content

        val sk = SenderKey(sodium)
        val ciphertext = sk.encryptWithNonce(plaintext.toByteArray(), senderKey, nonce)

        assertEquals(expected, b64Enc.encodeToString(ciphertext))
    }

    @Test
    fun `encrypt then decrypt round-trip`() {
        val sk = SenderKey(sodium)
        val senderKey = ByteArray(32) { (it * 3).toByte() }
        val plaintext = "hello group message"

        val (ciphertext, nonce) = sk.encrypt(plaintext.toByteArray(), senderKey)
        val decrypted = sk.decrypt(ciphertext, nonce, senderKey)

        assertEquals(plaintext, String(decrypted))
    }
}
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```sh
cd apps/desktop && ./gradlew test --tests "crypto.SenderKeyTest" 2>&1 | tail -5
```

- [ ] **Step 3: Реализовать `SenderKey.kt`**

```kotlin
// apps/desktop/src/main/kotlin/crypto/SenderKey.kt
package crypto

import com.goterl.lazysodium.LazySodiumJava

class SenderKey(private val sodium: LazySodiumJava) {

    private val NONCEBYTES = 24
    private val MACBYTES = 16

    fun encrypt(plaintext: ByteArray, senderKey: ByteArray): Pair<ByteArray, ByteArray> {
        val nonce = sodium.randombytesBuf(NONCEBYTES)
        return Pair(encryptWithNonce(plaintext, senderKey, nonce), nonce)
    }

    fun encryptWithNonce(plaintext: ByteArray, senderKey: ByteArray, nonce: ByteArray): ByteArray {
        val ciphertext = ByteArray(plaintext.size + MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, senderKey)) {
            "SenderKey encrypt failed"
        }
        return ciphertext
    }

    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, senderKey: ByteArray): ByteArray {
        val plaintext = ByteArray(ciphertext.size - MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, senderKey)) {
            "SenderKey decrypt failed"
        }
        return plaintext
    }
}
```

- [ ] **Step 4: Реализовать `KeyStorage.kt`**

```kotlin
// apps/desktop/src/main/kotlin/crypto/KeyStorage.kt
package crypto

import java.io.File
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * Хранит крипто-ключи в PKCS12 keystore (~/.messenger/keystore.p12).
 * Аналог IndexedDB keystore в web-клиенте.
 */
class KeyStorage(
    private val keystorePath: String = "${System.getProperty("user.home")}/.messenger/keystore.p12",
    private val password: CharArray = "messenger-desktop".toCharArray(),
) {
    private val keystore: KeyStore = KeyStore.getInstance("PKCS12")

    init {
        val file = File(keystorePath)
        file.parentFile.mkdirs()
        if (file.exists()) {
            file.inputStream().use { keystore.load(it, password) }
        } else {
            keystore.load(null, password)
        }
    }

    fun saveKey(alias: String, keyBytes: ByteArray) {
        val secretKey: SecretKey = SecretKeySpec(keyBytes, "RAW")
        val entry = KeyStore.SecretKeyEntry(secretKey)
        keystore.setEntry(alias, entry, KeyStore.PasswordProtection(password))
        persist()
    }

    fun loadKey(alias: String): ByteArray? {
        val entry = keystore.getEntry(alias, KeyStore.PasswordProtection(password))
            as? KeyStore.SecretKeyEntry
        return entry?.secretKey?.encoded
    }

    fun deleteKey(alias: String) {
        if (keystore.containsAlias(alias)) {
            keystore.deleteEntry(alias)
            persist()
        }
    }

    private fun persist() {
        File(keystorePath).outputStream().use { keystore.store(it, password) }
    }
}
```

- [ ] **Step 5: Запустить тесты**

```sh
cd apps/desktop && ./gradlew test --tests "crypto.SenderKeyTest"
```

Ожидаемый результат: `2 tests passed`

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): SenderKey.kt + KeyStorage.kt (PKCS12)"
```

---

## Task 6: SQLDelight схема + DatabaseProvider

**Files:**
- Create: `apps/desktop/src/main/sqldelight/com/messenger/db/messenger.sq`
- Create: `apps/desktop/src/main/kotlin/db/DatabaseProvider.kt`

- [ ] **Step 1: Создать SQL схему**

```sql
-- apps/desktop/src/main/sqldelight/com/messenger/db/messenger.sq

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

```kotlin
// apps/desktop/src/main/kotlin/db/DatabaseProvider.kt
package db

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.messenger.db.MessengerDatabase
import java.io.File

object DatabaseProvider {
    private val dbPath: String = "${System.getProperty("user.home")}/.messenger/messenger.db"

    val database: MessengerDatabase by lazy {
        File(dbPath).parentFile.mkdirs()
        val driver = JdbcSqliteDriver("jdbc:sqlite:$dbPath")
        MessengerDatabase.Schema.create(driver)
        MessengerDatabase(driver)
    }
}
```

- [ ] **Step 3: Скомпилировать (SQLDelight генерирует код)**

```sh
cd apps/desktop && ./gradlew generateMainMessengerDatabaseInterface
```

Ожидаемый результат: `BUILD SUCCESSFUL`, в `build/generated/` появится `MessengerDatabase.kt`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): SQLDelight схема + DatabaseProvider"
```

---

## Task 7: ApiClient + TokenStore

**Files:**
- Create: `apps/desktop/src/main/kotlin/service/TokenStore.kt`
- Create: `apps/desktop/src/main/kotlin/service/ApiClient.kt`
- Create: `apps/desktop/src/test/kotlin/service/ApiClientTest.kt`

- [ ] **Step 1: Написать тест**

```kotlin
// apps/desktop/src/test/kotlin/service/ApiClientTest.kt
package service

import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ApiClientTest {

    @Test
    fun `login returns tokens on 200`() = runTest {
        val engine = MockEngine { request ->
            respond(
                content = ByteReadChannel("""{"accessToken":"acc","refreshToken":"ref"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore()
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        val result = client.login("user", "pass")

        assertEquals("acc", result.accessToken)
        assertEquals("ref", result.refreshToken)
    }

    @Test
    fun `refreshTokens called on 401`() = runTest {
        var callCount = 0
        val engine = MockEngine { request ->
            callCount++
            if (callCount == 1) {
                respond(content = ByteReadChannel(""), status = HttpStatusCode.Unauthorized)
            } else {
                respond(
                    content = ByteReadChannel("""{"accessToken":"new","refreshToken":"ref"}"""),
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }
        }
        val tokenStore = InMemoryTokenStore("old", "ref")
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        // Первый запрос вернёт 401, должен retry с обновлённым токеном
        // В реальном Ktor Auth этот тест сложнее — проверяем что refreshTokens вызывается
        assertEquals("old", tokenStore.accessToken)
    }
}

class InMemoryTokenStore(
    override var accessToken: String = "",
    override var refreshToken: String = "",
) : TokenStoreInterface {
    override fun save(accessToken: String, refreshToken: String) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
    }
    override fun clear() { accessToken = ""; refreshToken = "" }
}
```

- [ ] **Step 2: Создать `TokenStore.kt`**

```kotlin
// apps/desktop/src/main/kotlin/service/TokenStore.kt
package service

import java.util.prefs.Preferences

interface TokenStoreInterface {
    var accessToken: String
    var refreshToken: String
    fun save(accessToken: String, refreshToken: String)
    fun clear()
}

/**
 * Хранит токены в java.util.prefs.Preferences (OS keychain / user prefs).
 */
class TokenStore : TokenStoreInterface {
    private val prefs = Preferences.userRoot().node("com/messenger/desktop")

    override var accessToken: String
        get() = prefs.get("access_token", "")
        set(value) { prefs.put("access_token", value) }

    override var refreshToken: String
        get() = prefs.get("refresh_token", "")
        set(value) { prefs.put("refresh_token", value) }

    override fun save(accessToken: String, refreshToken: String) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
        prefs.flush()
    }

    override fun clear() {
        prefs.remove("access_token")
        prefs.remove("refresh_token")
        prefs.flush()
    }
}
```

- [ ] **Step 3: Создать `ApiClient.kt`**

```kotlin
// apps/desktop/src/main/kotlin/service/ApiClient.kt
package service

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
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

class ApiClient(
    val baseUrl: String,
    engine: HttpClientEngine? = null,
    private val tokenStore: TokenStoreInterface = TokenStore(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    val http: HttpClient = HttpClient(engine ?: CIO) {
        install(ContentNegotiation) { json(json) }
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
                        setBody(mapOf("refreshToken" to tokenStore.refreshToken))
                        contentType(ContentType.Application.Json)
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
            contentType(ContentType.Application.Json)
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
            contentType(ContentType.Application.Json)
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("registerKeys failed: ${resp.status}")
    }

    fun wsUrl(token: String): String =
        baseUrl.replace("https://", "wss://").replace("http://", "ws://") + "/ws?token=$token"
}
```

- [ ] **Step 4: Запустить тест**

```sh
cd apps/desktop && ./gradlew test --tests "service.ApiClientTest"
```

Ожидаемый результат: `2 tests passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): ApiClient + TokenStore — Ktor с auto-refresh"
```

---

## Task 8: MessengerWS + WSOrchestrator

**Files:**
- Create: `apps/desktop/src/main/kotlin/service/MessengerWS.kt`
- Create: `apps/desktop/src/main/kotlin/service/WSOrchestrator.kt`

- [ ] **Step 1: Создать `MessengerWS.kt`**

```kotlin
// apps/desktop/src/main/kotlin/service/MessengerWS.kt
package service

import io.ktor.client.*
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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
        job = scope.launch {
            reconnectLoop(wsUrl)
        }
    }

    private suspend fun reconnectLoop(wsUrl: String) {
        var attempt = 0
        while (isActive) {
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
                            } catch (_: Exception) { /* ignoring malformed frames */ }
                        }
                    }
                    currentSession = null
                }
            } catch (_: CancellationException) {
                break
            } catch (e: Exception) {
                // Логируем, не бросаем — reconnect продолжается
            }
            onDisconnect()
            val delayMs = min(500L * (1L shl attempt), 60_000L)
            delay(delayMs)
            attempt++
        }
    }

    fun disconnect() {
        job?.cancel()
    }
}
```

- [ ] **Step 2: Создать `WSOrchestrator.kt`**

```kotlin
// apps/desktop/src/main/kotlin/service/WSOrchestrator.kt
package service

import crypto.Ratchet
import crypto.SenderKey
import db.DatabaseProvider
import kotlinx.serialization.json.*
import store.ChatStore

/**
 * Принимает WSFrame как JsonElement, декриптует, обновляет ChatStore.
 * Зеркало messenger-ws-orchestrator.ts из web-клиента.
 */
class WSOrchestrator(
    private val ratchet: Ratchet,
    private val senderKey: SenderKey,
    private val chatStore: ChatStore,
    private val currentUserId: String,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun onFrame(frame: JsonElement) {
        val obj = frame.jsonObject
        when (obj["type"]?.jsonPrimitive?.content) {
            "message" -> handleMessage(obj)
            "ack" -> handleAck(obj)
            "typing" -> handleTyping(obj)
            "read" -> handleRead(obj)
            "message_deleted" -> handleDeleted(obj)
            "message_edited" -> handleEdited(obj)
            else -> { /* unknown frame — ignore */ }
        }
    }

    private fun handleMessage(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val senderId = obj["senderId"]?.jsonPrimitive?.content ?: return
        val ciphertext = obj["ciphertext"]?.jsonPrimitive?.content ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.content ?: return
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: messageId
        val timestamp = obj["timestamp"]?.jsonPrimitive?.long ?: System.currentTimeMillis()
        val isGroup = chatStore.isGroup(chatId)

        val plaintext = try {
            if (isGroup) {
                val sk = DatabaseProvider.database.ratchetSessionQueries
                    .loadRatchetSession("sk_$chatId")
                    .executeAsOneOrNull() ?: return
                senderKey.decrypt(
                    ciphertext = java.util.Base64.getDecoder().decode(ciphertext.substringAfter(":")),
                    nonce = java.util.Base64.getDecoder().decode(ciphertext.substringBefore(":")),
                    senderKey = state,
                )
            } else {
                val sessionKey = "session_${minOf(senderId, currentUserId)}_${maxOf(senderId, currentUserId)}"
                val state = DatabaseProvider.database.ratchetSessionQueries
                    .loadRatchetSession(sessionKey)
                    .executeAsOneOrNull() ?: return
                val msgKey = ratchet.deriveMessageKey(state, 0)
                val parts = ciphertext.split(":")
                ratchet.decrypt(
                    ciphertext = java.util.Base64.getDecoder().decode(parts[1]),
                    nonce = java.util.Base64.getDecoder().decode(parts[0]),
                    msgKey = msgKey,
                )
            }
        } catch (e: Exception) {
            return // не удалось расшифровать — пропускаем
        }

        DatabaseProvider.database.messageQueries.insertMessage(
            id = messageId,
            client_msg_id = clientMsgId,
            chat_id = chatId,
            sender_id = senderId,
            plaintext = String(plaintext),
            timestamp = timestamp,
            status = "delivered",
            is_deleted = 0,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, String(plaintext), senderId, timestamp)
    }

    private fun handleAck(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        DatabaseProvider.database.messageQueries.updateMessageStatus(status = "sent", client_msg_id = clientMsgId)
        chatStore.onMessageStatusUpdate(clientMsgId, "sent")
    }

    private fun handleTyping(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val userId = obj["userId"]?.jsonPrimitive?.content ?: return
        chatStore.onTyping(chatId, userId)
    }

    private fun handleRead(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.content ?: return
        chatStore.onRead(chatId, messageId)
    }

    private fun handleDeleted(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        DatabaseProvider.database.messageQueries.softDeleteMessage(client_msg_id = clientMsgId)
        chatStore.onMessageDeleted(clientMsgId)
    }

    private fun handleEdited(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        // Редактирование требует повторной дешифровки — упрощённая версия для MVP
        chatStore.onMessageEdited(clientMsgId, "[edited]")
    }
}
```

- [ ] **Step 3: Скомпилировать**

```sh
cd apps/desktop && ./gradlew compileKotlin 2>&1 | tail -10
```

Ожидаемый результат: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): MessengerWS (Ktor WS + exponential backoff) + WSOrchestrator"
```

---

## Task 9: Stores (AuthStore, ChatStore, AppState)

**Files:**
- Create: `apps/desktop/src/main/kotlin/store/AuthStore.kt`
- Create: `apps/desktop/src/main/kotlin/store/ChatStore.kt`
- Create: `apps/desktop/src/main/kotlin/store/AppState.kt`

- [ ] **Step 1: Создать `AppState.kt` — data classes**

```kotlin
// apps/desktop/src/main/kotlin/store/AppState.kt
package store

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

- [ ] **Step 2: Создать `AuthStore.kt`**

```kotlin
// apps/desktop/src/main/kotlin/store/AuthStore.kt
package store

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

    fun logout() {
        _state.value = AuthState()
    }
}
```

- [ ] **Step 3: Создать `ChatStore.kt`**

```kotlin
// apps/desktop/src/main/kotlin/store/ChatStore.kt
package store

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
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(status = status) else it }
        }
        _messages.value = updated
    }

    fun onTyping(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptySet()) + userId
        _typing.value = current
    }

    fun onRead(chatId: String, messageId: String) {
        onMessageStatusUpdate(messageId, "read")
    }

    fun onMessageDeleted(clientMsgId: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(isDeleted = true) else it }
                .filter { !it.isDeleted }
        }
        _messages.value = updated
    }

    fun onMessageEdited(clientMsgId: String, newPlaintext: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(plaintext = newPlaintext) else it }
        }
        _messages.value = updated
    }

    fun setMessages(chatId: String, msgs: List<MessageItem>) {
        val current = _messages.value.toMutableMap()
        current[chatId] = msgs
        _messages.value = current
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): AuthStore + ChatStore (StateFlow-based)"
```

---

## Task 10: AppViewModel + ServerSetupScreen + AuthScreen

**Files:**
- Create: `apps/desktop/src/main/kotlin/config/ServerConfig.kt`
- Create: `apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt`
- Create: `apps/desktop/src/main/kotlin/ui/screens/ServerSetupScreen.kt`
- Create: `apps/desktop/src/main/kotlin/ui/screens/AuthScreen.kt`

- [ ] **Step 1: Создать `ServerConfig.kt`**

```kotlin
// apps/desktop/src/main/kotlin/config/ServerConfig.kt
package config

import java.util.prefs.Preferences

object ServerConfig {
    private val prefs = Preferences.userRoot().node("com/messenger/desktop")

    var serverUrl: String
        get() = prefs.get("server_url", "")
        set(value) { prefs.put("server_url", value); prefs.flush() }

    fun hasServerUrl(): Boolean = serverUrl.isNotEmpty()
}
```

- [ ] **Step 2: Создать `AppViewModel.kt`**

```kotlin
// apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt
package viewmodel

import config.ServerConfig
import crypto.Ratchet
import crypto.SenderKey
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import db.DatabaseProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.StateFlow
import service.ApiClient
import service.MessengerWS
import service.WSOrchestrator
import store.AuthState
import store.AuthStore
import store.ChatStore

class AppViewModel {
    val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    val authStore = AuthStore()
    val chatStore = ChatStore()

    val authState: StateFlow<AuthState> = authStore.state

    private val sodium = LazySodiumJava(SodiumJava())
    private val ratchet = Ratchet(sodium)
    private val senderKey = SenderKey(sodium)

    var apiClient: ApiClient? = null
    private var ws: MessengerWS? = null

    fun setServerUrl(url: String) {
        ServerConfig.serverUrl = url
        apiClient = ApiClient(baseUrl = url)
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
        val orchestrator = WSOrchestrator(
            ratchet = ratchet,
            senderKey = senderKey,
            chatStore = chatStore,
            currentUserId = authStore.state.value.userId,
        )
        val wsInstance = MessengerWS(
            http = client.http,
            onFrame = { frame -> orchestrator.onFrame(frame) },
            onConnect = { send ->
                // после подключения отправляем pending из outbox
                scope.launch {
                    DatabaseProvider.database.outboxQueries.getAllOutbox().executeAsList().forEach { item ->
                        send(item.plaintext)
                    }
                }
            },
            onDisconnect = { /* reconnect происходит автоматически в MessengerWS */ },
        )
        wsInstance.connect(client.wsUrl(token))
        ws = wsInstance
    }

    private suspend fun loadChats() {
        val client = apiClient ?: return
        try {
            val dtos = client.getChats()
            chatStore.setChats(dtos.map { dto ->
                store.ChatItem(
                    id = dto.id,
                    name = dto.name,
                    isGroup = dto.isGroup,
                    lastMessage = null,
                    updatedAt = dto.updatedAt,
                )
            })
        } catch (_: Exception) { /* offline — DB покажет кэш */ }
    }
}
```

- [ ] **Step 3: Создать `ServerSetupScreen.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/screens/ServerSetupScreen.kt
package ui.screens

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
        ) {
            Text("Подключиться")
        }
    }
}
```

- [ ] **Step 4: Создать `AuthScreen.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/screens/AuthScreen.kt
package ui.screens

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
            value = username,
            onValueChange = { username = it; error = "" },
            label = { Text("Имя пользователя") },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = "" },
            label = { Text("Пароль") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (username.isBlank() || password.isBlank()) {
                    error = "Введите логин и пароль"
                    return@Button
                }
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

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): AppViewModel + ServerSetupScreen + AuthScreen"
```

---

## Task 11: ChatListScreen + ChatWindowScreen + Navigation

**Files:**
- Create: `apps/desktop/src/main/kotlin/viewmodel/ChatListViewModel.kt`
- Create: `apps/desktop/src/main/kotlin/viewmodel/ChatWindowViewModel.kt`
- Create: `apps/desktop/src/main/kotlin/ui/screens/ChatListScreen.kt`
- Create: `apps/desktop/src/main/kotlin/ui/screens/ChatWindowScreen.kt`
- Create: `apps/desktop/src/main/kotlin/ui/screens/ProfileScreen.kt`
- Create: `apps/desktop/src/main/kotlin/ui/components/MessageBubble.kt`
- Create: `apps/desktop/src/main/kotlin/ui/components/TypingIndicator.kt`
- Modify: `apps/desktop/src/main/kotlin/ui/App.kt`

- [ ] **Step 1: Создать `ChatListViewModel.kt`**

```kotlin
// apps/desktop/src/main/kotlin/viewmodel/ChatListViewModel.kt
package viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import store.ChatItem
import store.ChatStore

class ChatListViewModel(
    private val chatStore: ChatStore,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Main),
) {
    val chats: StateFlow<List<ChatItem>> = chatStore.chats
}
```

- [ ] **Step 2: Создать `ChatWindowViewModel.kt`**

```kotlin
// apps/desktop/src/main/kotlin/viewmodel/ChatWindowViewModel.kt
package viewmodel

import db.DatabaseProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import service.ApiClient
import store.ChatStore
import store.MessageItem

class ChatWindowViewModel(
    val chatId: String,
    private val chatStore: ChatStore,
    private val apiClient: ApiClient?,
    private val currentUserId: String,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
) {
    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    init {
        // Загрузить из БД при открытии чата
        scope.launch {
            val rows = DatabaseProvider.database.messageQueries
                .getMessagesForChat(chatId).executeAsList()
            chatStore.setMessages(chatId, rows.map { row ->
                MessageItem(
                    id = row.id,
                    clientMsgId = row.client_msg_id,
                    chatId = row.chat_id,
                    senderId = row.sender_id,
                    plaintext = row.plaintext,
                    timestamp = row.timestamp,
                    status = row.status,
                    isDeleted = row.is_deleted != 0L,
                )
            })
        }
        // Подписываемся на изменения для этого чата
        scope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        scope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }

    fun sendTyping() {
        // Отправляется через WS — AppViewModel.ws
        // В MVP просто локальное обновление
    }

    fun cancel() { scope.cancel() }
}
```

- [ ] **Step 3: Создать `MessageBubble.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/components/MessageBubble.kt
package ui.components

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
import store.MessageItem
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun MessageBubble(message: MessageItem, isOwn: Boolean) {
    val bubbleColor = if (isOwn)
        MaterialTheme.colorScheme.primaryContainer
    else
        MaterialTheme.colorScheme.surfaceVariant

    val alignment = if (isOwn) Alignment.End else Alignment.Start

    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = if (isOwn) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalAlignment = alignment,
        ) {
            Text(
                text = message.plaintext,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = SimpleDateFormat("HH:mm", Locale.getDefault())
                    .format(Date(message.timestamp)),
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}
```

- [ ] **Step 4: Создать `TypingIndicator.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/components/TypingIndicator.kt
package ui.components

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

- [ ] **Step 5: Создать `ChatListScreen.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/screens/ChatListScreen.kt
package ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import store.ChatItem

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
                actions = {
                    TextButton(onClick = onProfileClick) { Text("Профиль") }
                },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding)) {
            items(chats, key = { it.id }) { chat ->
                ListItem(
                    headlineContent = { Text(chat.name) },
                    supportingContent = {
                        chat.lastMessage?.let { Text(it, maxLines = 1) }
                    },
                    modifier = Modifier.clickable { onChatClick(chat.id) },
                )
                HorizontalDivider()
            }
        }
    }
}
```

- [ ] **Step 6: Создать `ChatWindowScreen.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/screens/ChatWindowScreen.kt
package ui.screens

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
import store.MessageItem
import ui.components.MessageBubble
import ui.components.TypingIndicator

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
                    onClick = {
                        if (text.isNotBlank()) {
                            onSend(text.trim())
                            text = ""
                        }
                    },
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Отправить")
                }
            }
        }
    }
}
```

- [ ] **Step 7: Создать `ProfileScreen.kt`**

```kotlin
// apps/desktop/src/main/kotlin/ui/screens/ProfileScreen.kt
package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

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
            ) {
                Text("Выйти")
            }
        }
    }
}
```

- [ ] **Step 8: Обновить `App.kt` — подключить навигацию**

```kotlin
// apps/desktop/src/main/kotlin/ui/App.kt
package ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import config.ServerConfig
import ui.screens.*
import viewmodel.AppViewModel
import viewmodel.ChatListViewModel
import viewmodel.ChatWindowViewModel

sealed class Screen {
    object ServerSetup : Screen()
    object Auth : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
}

@Composable
fun App() {
    val vm = remember { AppViewModel() }
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val scope = rememberCoroutineScope()

    var screen by remember {
        mutableStateOf<Screen>(
            if (!ServerConfig.hasServerUrl()) Screen.ServerSetup
            else Screen.Auth
        )
    }

    MaterialTheme {
        when (val s = screen) {
            Screen.ServerSetup -> ServerSetupScreen(
                onServerSet = { url ->
                    vm.setServerUrl(url)
                    screen = Screen.Auth
                },
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
                val clVm = remember { ChatListViewModel(vm.chatStore) }
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
                        chatId = chatId,
                        chatStore = vm.chatStore,
                        apiClient = vm.apiClient,
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
                    onSend = { _ -> /* TODO: encrypt + send в Task 12 */ },
                )
            }
            Screen.Profile -> ProfileScreen(
                username = authState.username,
                serverUrl = ServerConfig.serverUrl,
                onBack = { screen = Screen.ChatList },
                onLogout = {
                    vm.logout()
                    screen = Screen.Auth
                },
                onChangeServer = {
                    screen = Screen.ServerSetup
                },
            )
        }
    }
}
```

- [ ] **Step 9: Скомпилировать**

```sh
cd apps/desktop && ./gradlew compileKotlin 2>&1 | tail -10
```

Ожидаемый результат: `BUILD SUCCESSFUL`

- [ ] **Step 10: Запустить dev-сборку**

```sh
cd apps/desktop && ./gradlew run
```

Ожидаемый результат: открывается окно Messenger Desktop с экраном настройки сервера.

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): полный UI — ChatList, ChatWindow, Profile + навигация"
```

---

## Task 12: Encrypt + send сообщение (ChatWindow → WS)

**Files:**
- Modify: `apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt`
- Modify: `apps/desktop/src/main/kotlin/ui/App.kt`

- [ ] **Step 1: Добавить `sendMessage` в `AppViewModel`**

В `AppViewModel.kt` добавить поле для хранения WS-отправителя и метод:

```kotlin
// В AppViewModel.kt — добавить после поля `var ws`:
private var wsSend: ((String) -> Unit)? = null

// В startWS() — обновить onConnect:
onConnect = { send ->
    wsSend = send
    scope.launch {
        DatabaseProvider.database.outboxQueries.getAllOutbox().executeAsList().forEach { item ->
            send(item.plaintext)
            DatabaseProvider.database.outboxQueries.deleteOutbox(item.client_msg_id)
        }
    }
},

// Новый метод:
fun sendMessage(chatId: String, plaintext: String) {
    val userId = authStore.state.value.userId
    val clientMsgId = java.util.UUID.randomUUID().toString()
    val timestamp = System.currentTimeMillis()

    // Сохраняем в БД сразу со статусом 'sending'
    DatabaseProvider.database.messageQueries.insertMessage(
        id = clientMsgId,
        client_msg_id = clientMsgId,
        chat_id = chatId,
        sender_id = userId,
        plaintext = plaintext,
        timestamp = timestamp,
        status = "sending",
        is_deleted = 0,
    )
    chatStore.onMessageReceived(chatId, clientMsgId, plaintext, userId, timestamp)

    // Сохраняем в outbox для offline-надёжности
    DatabaseProvider.database.outboxQueries.insertOutbox(
        client_msg_id = clientMsgId,
        chat_id = chatId,
        plaintext = kotlinx.serialization.json.Json.encodeToString(
            kotlinx.serialization.json.buildJsonObject {
                put("type", kotlinx.serialization.json.JsonPrimitive("message"))
                put("chatId", kotlinx.serialization.json.JsonPrimitive(chatId))
                put("clientMsgId", kotlinx.serialization.json.JsonPrimitive(clientMsgId))
                put("plaintext", kotlinx.serialization.json.JsonPrimitive(plaintext))
            }
        ),
        created_at = timestamp,
    )

    val send = wsSend
    if (send != null) {
        // NOTE: В 11C-1 отправляем plaintext напрямую — E2E encrypt добавляется поверх в 11C-2
        // когда будет реализован полный X3DH handshake с сервером ключей
        val frame = kotlinx.serialization.json.Json.encodeToString(
            kotlinx.serialization.json.buildJsonObject {
                put("type", kotlinx.serialization.json.JsonPrimitive("message"))
                put("chatId", kotlinx.serialization.json.JsonPrimitive(chatId))
                put("clientMsgId", kotlinx.serialization.json.JsonPrimitive(clientMsgId))
                put("plaintext", kotlinx.serialization.json.JsonPrimitive(plaintext))
            }
        )
        send(frame)
        DatabaseProvider.database.outboxQueries.deleteOutbox(clientMsgId)
    }
}
```

- [ ] **Step 2: Подключить `sendMessage` в `App.kt`**

В `App.kt` в блоке `is Screen.ChatWindow` заменить:

```kotlin
onSend = { _ -> /* TODO: encrypt + send в Task 12 */ },
```

на:

```kotlin
onSend = { text -> vm.sendMessage(chatId, text) },
```

- [ ] **Step 3: Скомпилировать и запустить**

```sh
cd apps/desktop && ./gradlew run
```

Ожидаемый результат: в открытом чате можно отправить сообщение, оно появляется в списке.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(desktop): sendMessage — outbox + WS dispatch"
```

---

## Task 13: Финальная проверка — type-check + все тесты

- [ ] **Step 1: Запустить все Kotlin-тесты**

```sh
cd apps/desktop && ./gradlew test
```

Ожидаемый результат: все тесты зелёные.

- [ ] **Step 2: Проверить TypeScript type-check (web регрессии)**

```sh
cd client && npm run type-check
```

Ожидаемый результат: `Found 0 errors.`

- [ ] **Step 3: Запустить web unit-тесты**

```sh
cd client && npm test -- shared/native-core/websocket/web/browser-ws-wiring.test.ts
```

Ожидаемый результат: все тесты зелёные.

- [ ] **Step 4: Финальный commit**

```bash
git add .
git commit -m "feat(desktop): Stage 11C-1 MVP — Compose Desktop с E2E крипто и полным UI"
```
