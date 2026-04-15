package db

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.messenger.db.MessengerDatabase
import java.io.File

object DatabaseProvider {
    private val dbPath: String = "${System.getProperty("user.home")}/.messenger/messenger.db"

    val database: MessengerDatabase by lazy {
        val file = File(dbPath)
        file.parentFile.mkdirs()
        val driver = JdbcSqliteDriver("jdbc:sqlite:$dbPath")

        val version = driver.executeQuery(
            identifier = null,
            sql = "PRAGMA user_version",
            mapper = { cursor -> QueryResult.Value(cursor.getLong(0) ?: 0L) },
            parameters = 0,
        ).value

        when (version) {
            0L -> {
                // Новая БД — создаём схему и ставим версию 2
                MessengerDatabase.Schema.create(driver)
                driver.execute(null, "PRAGMA user_version = 2", 0)
            }
            1L -> {
                // Существующая БД без media-колонок — мигрируем
                driver.execute(null, "ALTER TABLE message ADD COLUMN media_id TEXT", 0)
                driver.execute(null, "ALTER TABLE message ADD COLUMN media_key TEXT", 0)
                driver.execute(null, "ALTER TABLE message ADD COLUMN original_name TEXT", 0)
                driver.execute(null, "ALTER TABLE message ADD COLUMN content_type TEXT", 0)
                driver.execute(null, "PRAGMA user_version = 2", 0)
            }
            // version >= 2: схема актуальна
        }

        MessengerDatabase(driver)
    }
}
