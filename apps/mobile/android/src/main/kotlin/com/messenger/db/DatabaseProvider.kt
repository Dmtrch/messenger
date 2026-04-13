// apps/mobile/android/src/main/kotlin/com/messenger/db/DatabaseProvider.kt
package com.messenger.db

import android.content.Context
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.messenger.db.MessengerDatabase

class DatabaseProvider(context: Context) {
    val database: MessengerDatabase by lazy {
        MessengerDatabase(AndroidSqliteDriver(MessengerDatabase.Schema, context, "messenger.db"))
    }
}
