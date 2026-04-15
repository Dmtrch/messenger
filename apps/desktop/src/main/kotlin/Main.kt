// apps/desktop/src/main/kotlin/Main.kt
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import config.ServerConfig
import logger.AppErrorLogger
import ui.App

fun main() {
    AppErrorLogger.init()
    AppErrorLogger.flushToServer(ServerConfig.serverUrl)

    application {
        Window(
            onCloseRequest = ::exitApplication,
            title = "Messenger",
        ) {
            App()
        }
    }
}
