package local.phantom.companion.pair

import kotlinx.serialization.Serializable

/**
 * Mirrors the Python `build_qr_payload` shape in
 * `src/backend/security/pair_crypto.py`. All fields are required at the
 * server's emission point; we mark the cert pin nullable purely so a
 * legacy `dev-no-pin` value still parses without a custom decoder.
 */
@Serializable
data class QrPayload(
    val v: Int,
    val host: String,
    val ip: String,
    val port: Int,
    val pair_id: String,
    val server_pub: String,
    val server_cert_sha256: String? = null,
    val exp: Long,
    val nonce: String,
) {
    /**
     * `phantom-os` accepts pairing on a LAN dev box without TLS termination
     * (sentinel "dev-no-pin"). On any other value the client MUST cert-pin
     * the Caddy fingerprint at the OkHttp layer.
     */
    val devNoPin: Boolean get() = server_cert_sha256.isNullOrBlank() || server_cert_sha256 == "dev-no-pin"

    fun baseUrl(scheme: String = if (devNoPin) "http" else "https"): String {
        // Prefer numeric IP — `phantom.local` mDNS resolution is flaky on
        // Android over corporate Wi-Fi. The desktop fills `ip` with its
        // best-guess LAN address per `_local_ip_guess()` server-side.
        return "$scheme://$ip:$port"
    }
}
