package local.phantom.companion.pair

import android.util.Base64
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.crypto.digests.SHA256Digest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Client-side mirror of `src/backend/security/pair_crypto.py`.
 *
 * BouncyCastle does the X25519 / Ed25519 / HKDF math because:
 *   - Android's KeyAgreement("XDH") requires API 33+; we floor at minSdk 29.
 *   - JCA Ed25519 lands in API 30+ but with implementation gaps before 33.
 *   - BC ships a pure-JVM impl that matches `cryptography` (Python) byte-for-byte.
 *
 * Long-term Ed25519 keys live in [PairedDeviceStore]'s EncryptedSharedPreferences
 * (Keystore-wrapped master key). StrongBox-backed keys land in Phase 2 once
 * minSdk can move to 31.
 */
object PairCrypto {

    private const val HKDF_INFO = "phantom-os/mobile-pair-v1"

    /** Ephemeral X25519 key pair generated for one /pair/claim attempt. */
    data class EphemeralX25519(val privateKey: X25519PrivateKeyParameters, val publicB64: String)

    /** Long-term Ed25519 device key (stored encrypted-at-rest after pairing). */
    data class DeviceEd25519(
        val privateRaw: ByteArray,
        val publicRaw: ByteArray,
        val publicB64: String,
    )

    fun newEphemeralX25519(rng: SecureRandom = SecureRandom()): EphemeralX25519 {
        val priv = X25519PrivateKeyParameters(rng)
        val pubBytes = priv.generatePublicKey().encoded
        return EphemeralX25519(
            privateKey = priv,
            publicB64 = base64(pubBytes),
        )
    }

    fun newDeviceEd25519(rng: SecureRandom = SecureRandom()): DeviceEd25519 {
        val priv = Ed25519PrivateKeyParameters(rng)
        val privBytes = priv.encoded
        val pubBytes = priv.generatePublicKey().encoded
        return DeviceEd25519(
            privateRaw = privBytes,
            publicRaw = pubBytes,
            publicB64 = base64(pubBytes),
        )
    }

    /** ECDH(c_priv, s_pub) → HKDF-SHA256(salt = nonce, info = HKDF_INFO) → 32 bytes. */
    fun deriveSharedKey(
        clientPriv: X25519PrivateKeyParameters,
        serverPubB64: String,
        nonceBytes: ByteArray,
    ): ByteArray {
        val serverPubRaw = base64Decode(serverPubB64)
        require(serverPubRaw.size == 32) { "server_pub must be 32 bytes raw" }
        val agreement = X25519Agreement().apply { init(clientPriv) }
        val shared = ByteArray(agreement.agreementSize)
        agreement.calculateAgreement(X25519PublicKeyParameters(serverPubRaw, 0), shared, 0)

        val hkdf = HKDFBytesGenerator(SHA256Digest()).apply {
            init(HKDFParameters(shared, nonceBytes, HKDF_INFO.toByteArray(Charsets.US_ASCII)))
        }
        val out = ByteArray(32)
        hkdf.generateBytes(out, 0, out.size)
        return out
    }

    /** HMAC-SHA256(K, pair_id || device_pub_raw) — returns the base64 proof. */
    fun clientProof(sharedKey: ByteArray, pairId: String, devicePubRaw: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(sharedKey, "HmacSHA256"))
        mac.update(pairId.toByteArray(Charsets.UTF_8))
        mac.update(devicePubRaw)
        return base64(mac.doFinal())
    }

    /** Verify the server's HMAC-SHA256(K, device_jwt) — returns true on match. */
    fun verifyServerProof(sharedKey: ByteArray, deviceJwt: String, serverProofB64: String): Boolean {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(sharedKey, "HmacSHA256"))
        val expected = mac.doFinal(deviceJwt.toByteArray(Charsets.UTF_8))
        val actual = base64Decode(serverProofB64)
        return constantTimeEquals(expected, actual)
    }

    /** Sign `device_id:nonce_b64` for /pair/refresh. */
    fun signRefresh(privateRaw: ByteArray, deviceId: String, nonceB64: String): String {
        val signer = Ed25519Signer().apply {
            init(true, Ed25519PrivateKeyParameters(privateRaw, 0))
        }
        val msg = "$deviceId:$nonceB64".toByteArray(Charsets.UTF_8)
        signer.update(msg, 0, msg.size)
        return base64(signer.generateSignature())
    }

    /** Verify a public key encoded base64 actually parses to 32 bytes. */
    fun parseEd25519Public(publicB64: String): Ed25519PublicKeyParameters {
        val raw = base64Decode(publicB64)
        require(raw.size == 32) { "ed25519 pubkey must be 32 bytes" }
        return Ed25519PublicKeyParameters(raw, 0)
    }

    fun base64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.NO_PADDING)

    fun base64Decode(value: String): ByteArray {
        // Mirror Python's tolerant decoder — accept padded/unpadded, std/urlsafe.
        val cleaned = value.trim().trimEnd('=')
        return Base64.decode(cleaned, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE)
    }

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }
}
