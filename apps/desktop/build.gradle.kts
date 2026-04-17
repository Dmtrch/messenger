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
    sourceSets.getByName("main").kotlin.srcDir(layout.buildDirectory.dir("generated/kotlin"))
}

val defaultServerUrl: String = System.getenv("SERVER_URL") ?: ""

val generateBuildConfig by tasks.registering {
    val outFile = layout.buildDirectory.file("generated/kotlin/config/BuildConfig.kt")
    outputs.file(outFile)
    doLast {
        outFile.get().asFile.parentFile.mkdirs()
        outFile.get().asFile.writeText(
            "package config\nobject BuildConfig {\n    const val DEFAULT_SERVER_URL = \"$defaultServerUrl\"\n}\n"
        )
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(generateBuildConfig)
}

repositories {
    mavenCentral()
    google()
    maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
}

dependencies {
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
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

    // WebRTC JNI bindings for desktop (macOS/Linux/Windows)
    implementation("dev.onvoid.webrtc:webrtc-java:0.8.0")
    val os   = System.getProperty("os.name",  "").lowercase()
    val arch = System.getProperty("os.arch",  "").lowercase()
    val nativeClassifier = when {
        os.contains("mac")  && arch.contains("aarch64") -> "macos-aarch64"
        os.contains("mac")                              -> "macos-x86_64"
        os.contains("linux")                            -> "linux-x86_64"
        os.contains("win")                              -> "windows-x86_64"
        else -> error("Unsupported platform for WebRTC: $os / $arch")
    }
    runtimeOnly("dev.onvoid.webrtc:webrtc-java:0.8.0:$nativeClassifier")

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

val appVersion: String = (findProperty("appVersion") as? String)?.takeIf { it.isNotBlank() } ?: "1.0.0"

compose.desktop {
    application {
        mainClass = "MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "Messenger"
            packageVersion = appVersion
            macOS { bundleID = "com.messenger.desktop" }
            windows { menuGroup = "Messenger" }
            linux { packageName = "messenger" }
        }
    }
}
