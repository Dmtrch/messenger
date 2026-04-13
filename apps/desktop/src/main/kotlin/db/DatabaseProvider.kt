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
