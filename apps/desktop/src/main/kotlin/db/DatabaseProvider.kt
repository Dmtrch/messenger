package db

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.messenger.db.MessengerDatabase
import java.io.File

object DatabaseProvider {
    private val dbPath: String = "${System.getProperty("user.home")}/.messenger/messenger.db"

    val database: MessengerDatabase by lazy {
        val file = File(dbPath)
        file.parentFile.mkdirs()
        val isNew = !file.exists() || file.length() == 0L
        val driver = JdbcSqliteDriver("jdbc:sqlite:$dbPath")
        if (isNew) MessengerDatabase.Schema.create(driver)
        MessengerDatabase(driver)
    }
}
