package local.phantom.companion.net

import android.os.Build
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpRequestRetry
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import local.phantom.companion.BuildConfig
import local.phantom.companion.data.PairedDevice
import local.phantom.companion.data.PairedDeviceStore

/**
 * Thin REST surface against phantom-os.
 *
 *   POST /api/v1/pair/claim          (no auth)
 *   POST /api/v1/pair/refresh        (no auth, body-signed)
 *   POST /api/v1/sensors/mobile_batch (device JWT)
 *   PATCH /api/v1/auth/me            (device JWT)
 *
 * Ktor + OkHttp gives us connection pooling and a stable WS engine reused by
 * [PhantomLink]. One `HttpClient` is shared across REST and WS so OkHttp's
 * pool isn't fragmented.
 */
class PhantomApi(private val store: PairedDeviceStore) {

    val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    val client: HttpClient = HttpClient(OkHttp) {
        engine {
            // OkHttp's connection pool is shared across requests. WS reuses
            // the same engine so we don't pay TLS handshake again.
            preconfigured = okhttp3.OkHttpClient.Builder().build()
        }
        install(ContentNegotiation) { json(this@PhantomApi.json) }
        install(WebSockets)
        install(HttpTimeout) {
            requestTimeoutMillis = 20_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 60_000
        }
        install(HttpRequestRetry) {
            retryOnExceptionOrServerErrors(maxRetries = 2)
            exponentialDelay()
        }
        install(Logging) {
            level = if (BuildConfig.DEBUG) LogLevel.INFO else LogLevel.NONE
        }
    }

    @Serializable
    data class ClaimRequest(
        val pair_id: String,
        val client_pub: String,
        val device_pub_ed25519: String,
        val nonce_echo: String,
        val client_proof: String,
        val device: Map<String, String>,
    )

    @Serializable
    data class ClaimResponse(
        val device_jwt: String,
        val device_id: String,
        val expires_at: String,
        val server_proof: String,
        val user: User,
    )

    @Serializable data class User(val id: String, val username: String, val role: String)

    @Serializable
    data class RefreshRequest(val old_token: String, val nonce_b64: String, val signature_b64: String)

    @Serializable data class RefreshResponse(val device_jwt: String, val expires_at: String)

    suspend fun claim(baseUrl: String, body: ClaimRequest): ClaimResponse {
        val res = client.post("$baseUrl/api/v1/pair/claim") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        if (res.status != HttpStatusCode.OK) {
            throw PhantomApiException("claim failed: ${res.status} ${res.bodyAsText().take(200)}")
        }
        return json.decodeFromString(ClaimResponse.serializer(), res.bodyAsText())
    }

    suspend fun refresh(baseUrl: String, body: RefreshRequest): RefreshResponse {
        val res = client.post("$baseUrl/api/v1/pair/refresh") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        if (res.status != HttpStatusCode.OK) {
            throw PhantomApiException("refresh failed: ${res.status} ${res.bodyAsText().take(200)}")
        }
        return json.decodeFromString(RefreshResponse.serializer(), res.bodyAsText())
    }

    @Serializable
    data class MobileBatch(
        val device_ts_ms: Long,
        val gps: Gps? = null,
        val motion_class: String? = null,
        val mic_rms: Float? = null,
        val body: Body? = null,
        val ble: List<BleObs> = emptyList(),
        val wifi: List<WifiObs> = emptyList(),
    ) {
        @Serializable data class Gps(val lat: Double, val lon: Double, val accuracy_m: Double? = null)
        @Serializable data class Body(val bpm: Float? = null, val hrv: Float? = null)
        @Serializable data class BleObs(val mac: String? = null, val name: String? = null, val rssi: Int)
        @Serializable
        data class WifiObs(
            val mac: String,
            val ssid: String = "",
            val rssi: Int = -100,
            val encryption: String = "unknown",
            val channel: Int = 0,
        )
    }

    @Serializable
    data class MobileBatchAck(
        val ok: Boolean,
        val batch_id: Long,
        val received_at: String,
        val wardriving_inserted: Int = 0,
        val wardriving_updated: Int = 0,
    )

    suspend fun postMobileBatch(batch: MobileBatch): MobileBatchAck {
        val paired = store.load() ?: throw PhantomApiException("not paired")
        val res = client.post("${paired.baseUrl}/api/v1/sensors/mobile_batch") {
            bearerAuth(paired.deviceJwt)
            contentType(ContentType.Application.Json)
            setBody(batch)
        }
        if (res.status != HttpStatusCode.OK) {
            throw PhantomApiException("mobile_batch failed: ${res.status}")
        }
        return json.decodeFromString(MobileBatchAck.serializer(), res.bodyAsText())
    }

    suspend fun unpair() {
        store.clear()
    }

    companion object {
        fun deviceMeta(): Map<String, String> = mapOf(
            "name" to (Build.MODEL ?: "android"),
            "model" to "${Build.MANUFACTURER}/${Build.MODEL}",
            "platform" to "android",
            "os_version" to "${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})",
        )
    }
}

class PhantomApiException(message: String) : RuntimeException(message)
