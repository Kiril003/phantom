package local.phantom.companion.vm

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import local.phantom.companion.PhantomApp
import local.phantom.companion.data.AppContainer
import local.phantom.companion.data.PairedDevice
import local.phantom.companion.net.LinkStatus
import local.phantom.companion.net.PhantomApi
import local.phantom.companion.pair.PairCrypto
import local.phantom.companion.pair.QrPayload
import local.phantom.companion.ui.theme.SystemState

/**
 * Single root ViewModel — the alternative was three or four small VMs that all
 * needed to read each other's state. With the Tier 1 surface (paired-or-not,
 * link status, vitals snapshot, ptt mode) one holder is the simplest thing
 * that works and stays under 200 lines.
 */
class PhantomViewModel(
    private val container: AppContainer,
) : ViewModel() {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private val _state = MutableStateFlow(
        UiState(paired = container.store.load()),
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        if (state.value.paired != null) {
            container.link.start()
        }
        viewModelScope.launch {
            container.link.connected.collect { ls ->
                _state.update { it.copy(linkStatus = ls) }
            }
        }
        viewModelScope.launch {
            container.link.events.collect { event ->
                when (event.channel) {
                    "state" -> {
                        val name = (event.raw["data"] as? kotlinx.serialization.json.JsonObject)
                            ?.get("state")?.jsonPrimitive?.content
                        if (name != null) {
                            _state.update { it.copy(systemState = parseState(name)) }
                        }
                    }
                    "sensor" -> {
                        // Vitals payloads from the desktop sensor pipeline.
                        val data = event.raw["data"] as? kotlinx.serialization.json.JsonObject
                        val body = data?.get("body") as? kotlinx.serialization.json.JsonObject
                        val bpm = body?.get("bpm")?.jsonPrimitive?.contentOrNull()?.toFloatOrNull()?.toInt()
                        if (bpm != null) {
                            _state.update { it.copy(bpm = bpm) }
                        }
                    }
                }
            }
        }
    }

    private fun parseState(name: String): SystemState = runCatching {
        SystemState.valueOf(name.uppercase())
    }.getOrDefault(SystemState.FOCUS)

    fun beginClaim() {
        // No-op trigger to switch the UI into "scan a QR" affordance. The
        // actual claim happens via [claimFromQrJson]; this keeps the test
        // path symmetric with the camera path even though the camera scan
        // is invoked by the Pair screen directly.
        _state.update { it.copy(pairError = null) }
    }

    fun claimFromQrJson(qrJson: String) {
        viewModelScope.launch {
            try {
                val qr = json.decodeFromString(QrPayload.serializer(), qrJson)
                if (qr.exp < (System.currentTimeMillis() / 1000)) {
                    _state.update { it.copy(pairError = "QR expired — попроси новий") }
                    return@launch
                }
                val nonceRaw = PairCrypto.base64Decode(qr.nonce)
                val ephemeral = PairCrypto.newEphemeralX25519()
                val device = PairCrypto.newDeviceEd25519()
                val sharedKey = PairCrypto.deriveSharedKey(
                    clientPriv = ephemeral.privateKey,
                    serverPubB64 = qr.server_pub,
                    nonceBytes = nonceRaw,
                )
                val proof = PairCrypto.clientProof(
                    sharedKey = sharedKey,
                    pairId = qr.pair_id,
                    devicePubRaw = device.publicRaw,
                )
                val claim = PhantomApi.ClaimRequest(
                    pair_id = qr.pair_id,
                    client_pub = ephemeral.publicB64,
                    device_pub_ed25519 = device.publicB64,
                    nonce_echo = qr.nonce,
                    client_proof = proof,
                    device = PhantomApi.deviceMeta(),
                )
                val response = container.api.claim(qr.baseUrl(), claim)
                val verified = PairCrypto.verifyServerProof(
                    sharedKey = sharedKey,
                    deviceJwt = response.device_jwt,
                    serverProofB64 = response.server_proof,
                )
                if (!verified) {
                    _state.update { it.copy(pairError = "Сервер не пройшов перевірку proof") }
                    return@launch
                }
                val paired = PairedDevice(
                    baseUrl = qr.baseUrl(),
                    devNoPin = qr.devNoPin,
                    deviceId = response.device_id,
                    userId = response.user.id,
                    username = response.user.username,
                    deviceJwt = response.device_jwt,
                    expiresAt = response.expires_at,
                    deviceEd25519Priv = PairCrypto.base64(device.privateRaw),
                    deviceEd25519Pub = device.publicB64,
                )
                container.store.save(paired)
                _state.update { it.copy(paired = paired, pairError = null) }
                container.link.start()
            } catch (t: Throwable) {
                _state.update { it.copy(pairError = "Помилка з'єднання: ${t.message ?: "невідомо"}") }
            }
        }
    }

    fun unpair() {
        viewModelScope.launch {
            container.link.stop()
            container.api.unpair()
            _state.update {
                UiState(paired = null)
            }
        }
    }

    fun setTab(tab: NavTab) {
        _state.update { it.copy(tab = tab) }
    }

    fun setPtt(state: PttRuntime) {
        _state.update { it.copy(ptt = state) }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val ctx = (this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as? Context)
                    ?: PhantomApp.container().let { return@initializer PhantomViewModel(it) }
                PhantomViewModel(PhantomApp.container())
            }
        }
    }
}

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? = runCatching { content }.getOrNull()

enum class NavTab { Pulse, Voice, Map, Comms, Vault }

data class PttRuntime(val state: local.phantom.companion.ui.components.PttState, val audioLevel: Float = 0f)

data class UiState(
    val paired: PairedDevice? = null,
    val pairError: String? = null,
    val linkStatus: LinkStatus = LinkStatus.Disconnected,
    val systemState: SystemState = SystemState.FOCUS,
    val bpm: Int? = null,
    val breath: Int? = null,
    val stress: Float? = null,
    val tab: NavTab = NavTab.Pulse,
    val ptt: PttRuntime = PttRuntime(local.phantom.companion.ui.components.PttState.Idle),
)
