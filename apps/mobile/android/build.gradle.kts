// apps/mobile/android/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.sqldelight)
}

val appVersion: String = (findProperty("appVersion") as? String)?.takeIf { it.isNotBlank() } ?: "1.0.0"

android {
    namespace = "com.messenger"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.messenger"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = appVersion
        // Baked-in server URL for pre-configured distributions; empty = user enters manually
        buildConfigField("String", "SERVER_URL", "\"${System.getenv("SERVER_URL") ?: ""}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

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
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("org.webrtc:google-webrtc:1.0.32006")
    implementation("androidx.biometric:biometric:1.2.0-alpha05")
    // FCM — для push-уведомлений. Требует google-services.json в корне модуля.
    // Без него Firebase инициализируется gracefully (не крашит). Плагин google-services
    // добавить вручную когда будет готов google-services.json:
    //   plugins { id("com.google.gms.google-services") }
    implementation("com.google.firebase:firebase-messaging:24.0.0")
    // TODO: re-enable when Google Maven is accessible (googleapis CDN 404 in this dev environment)
    // implementation(libs.security.crypto)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.viewmodel.compose)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.lazysodium.java)
    testImplementation("app.cash.sqldelight:sqlite-driver:2.0.2")
}

sqldelight {
    databases {
        create("MessengerDatabase") {
            packageName.set("com.messenger.db")
            srcDirs("src/main/sqldelight")
        }
    }
}
