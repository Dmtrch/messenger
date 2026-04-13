// apps/mobile/android/src/main/kotlin/com/messenger/MessengerApp.kt
package com.messenger

import android.app.Application
import com.messenger.config.ServerConfig

class MessengerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServerConfig.init(this)
    }
}
