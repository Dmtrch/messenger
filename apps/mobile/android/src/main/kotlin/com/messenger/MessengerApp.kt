// apps/mobile/android/src/main/kotlin/com/messenger/MessengerApp.kt
package com.messenger

import android.app.Application
import com.messenger.config.ServerConfig
import com.messenger.logger.ErrorLogger

class MessengerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServerConfig.init(this)
        ErrorLogger.init(this)
        // Отправить логи с предыдущего сеанса, если сервер уже настроен.
        ErrorLogger.flushToServer(ServerConfig.serverUrl)
    }
}
