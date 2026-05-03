package local.phantom.companion.net

import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.url
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import local.phantom.companion.data.PairedDeviceStore
import java.net.URI
import java.util.concurrent.atomic.AtomicReference

/**
 * Persistent WebSocket link to phantom-os.
 *
 * Implements the Mobile Companion §6 transport: phone subscribes to a narrow
 * channel set (sensor / context / state / familiar / pair) instead of pulling
 * raw `agent.stream` traffic. Reconnect uses exponential backoff (1→2→5→15→60
 * seconds) capped to keep the foreground service from spinning the radio.
 */
class PhantomLink(
    private val api: PhantomApi,
    private val store: PairedDeviceStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sessionRef = AtomicReference<DefaultClientWebSocketSession?>(null)
    private var loop: Job? = null

    private val _connected = MutableStateFlow(LinkStatus.Disconnected)
    val connected: StateFlow<LinkStatus> = _connected.asStateFlow()

    private val _events = MutableSharedFlow<HubEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<HubEvent> = _events.asSharedFlow()

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    val channels: Set<String> = setOf("sensor", "context", "state", "familiar", "pair", "agent")

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { connectLoop() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        scope.launch { sessionRef.getAndSet(null)?.close() }
    }

    private suspend fun connectLoop() {
        var backoffMs = 1_000L
        while (currentCoroutineActive()) {
            val paired = store.load()
            if (paired == null) {
                _connected.value = LinkStatus.Disconnected
                delay(2_000)
                continue
            }
            try {
                _connected.value = LinkStatus.Connecting
                val uri = URI(paired.baseUrl)
                val isTls = uri.scheme.equals("https", ignoreCase = true)
                val wsScheme = if (isTls) "wss" else "ws"
                val port = if (uri.port > 0) uri.port else if (isTls) 443 else 80
                val wsUrl = "$wsScheme://${uri.host}:$port/api/v1/ws?token=${paired.deviceJwt}"
                val session = api.client.webSocketSession { url(wsUrl) }
                sessionRef.set(session)
                _connected.value = LinkStatus.Connected
                backoffMs = 1_000L

                // Subscribe — Phase 19-6 channel filter.
                session.send(Frame.Text(json.encodeToString(
                    SubscribeMessage.serializer(),
                    SubscribeMessage(control = "subscribe", channels = channels.toList()),
                )))

                for (frame in session.incoming) {
                    if (frame is Frame.Text) {
                        try {
                            val obj = json.decodeFromString(JsonObject.serializer(), frame.readText())
                            val channel = obj["channel"]?.toString()?.trim('"')
                            if (channel.isNullOrBlank()) continue
                            val type = obj["type"]?.toString()?.trim('"') ?: ""
                            _events.emit(HubEvent(channel, type, obj))
                        } catch (_: Throwable) {
                            // Best-effort decoding — frames that fail to parse
                            // are dropped rather than aborting the whole link.
                        }
                    }
                }
            } catch (t: Throwable) {
                _connected.value = LinkStatus.Disconnected
            } finally {
                sessionRef.set(null)
            }
            // Exponential backoff to 60 s. Doze friendliness: wakeup is owned
            // by the foreground service, not WorkManager periodic timers.
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000)
        }
    }

    private fun currentCoroutineActive(): Boolean = (loop?.isActive ?: false)

    suspend fun send(text: String): Boolean = withContext(Dispatchers.IO) {
        val s = sessionRef.get() ?: return@withContext false
        runCatching { s.send(Frame.Text(text)) }.isSuccess
    }
}

enum class LinkStatus { Disconnected, Connecting, Connected }

data class HubEvent(val channel: String, val type: String, val raw: JsonObject)

@Serializable
private data class SubscribeMessage(val control: String, val channels: List<String>)
