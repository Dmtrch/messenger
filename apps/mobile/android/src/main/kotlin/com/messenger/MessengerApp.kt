// apps/mobile/android/src/main/kotlin/com/messenger/MessengerApp.kt
package com.messenger

import android.app.Application
import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.messenger.config.ServerConfig
import com.messenger.logger.ErrorLogger
import com.messenger.service.MessengerFirebaseService

class MessengerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServerConfig.init(this)
        ErrorLogger.init(this)
        // Отправить логи с предыдущего сеанса, если сервер уже настроен.
        ErrorLogger.flushToServer(ServerConfig.serverUrl)
        primeFcmToken()
    }

    // onNewToken срабатывает только при первой регистрации или ротации;
    // после переустановки токен уже есть, и сервис не вызывается. Явно
    // запрашиваем токен при старте и сохраняем в те же SharedPreferences,
    // откуда AppViewModel его подхватывает при логине.
    private fun primeFcmToken() {
        if (FirebaseApp.getApps(this).isEmpty()) return
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) return@addOnCompleteListener
                val token = task.result ?: return@addOnCompleteListener
                getSharedPreferences(MessengerFirebaseService.PREFS, Context.MODE_PRIVATE)
                    .edit().putString(MessengerFirebaseService.KEY_TOKEN, token).apply()
            }
        } catch (_: Exception) {
            // Firebase недоступен — приложение работает без push.
        }
    }
}
