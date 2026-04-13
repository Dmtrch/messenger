package service

import io.ktor.client.*
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.coroutines.coroutineContext
import kotlin.math.min

class MessengerWS(
    private val http: HttpClient,
    private val onFrame: (JsonElement) -> Unit,
    private val onConnect: (send: (String) -> Unit) -> Unit,
    private val onDisconnect: () -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var job: Job? = null

    fun connect(wsUrl: String) {
        job = scope.launch {
            reconnectLoop(wsUrl)
        }
    }

    private suspend fun reconnectLoop(wsUrl: String) {
        var attempt = 0
        while (coroutineContext.isActive) {
            try {
                http.webSocket(wsUrl) {
                    attempt = 0
                    var currentSession: DefaultClientWebSocketSession? = this
                    onConnect { msg -> launch { currentSession?.send(msg) } }
                    for (frame in incoming) {
                        if (frame is Frame.Text) {
                            val text = frame.readText()
                            try {
                                val el = Json.parseToJsonElement(text)
                                onFrame(el)
                            } catch (_: Exception) { /* игнорируем некорректные фреймы */ }
                        }
                    }
                    currentSession = null
                }
            } catch (_: CancellationException) {
                break
            } catch (e: Exception) {
                // Логируем, не бросаем — reconnect продолжается
            }
            onDisconnect()
            val delayMs = min(500L * (1L shl attempt), 60_000L)
            delay(delayMs)
            attempt++
        }
    }

    fun disconnect() {
        job?.cancel()
    }
}
