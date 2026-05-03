package local.phantom.companion.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Keystore-wrapped persistence for the device JWT, base URL, owning user
 * info, and the long-term Ed25519 key used by /pair/refresh.
 *
 * EncryptedSharedPreferences pulls a master key from Android Keystore on first
 * open; all values are AES-256-GCM-encrypted at rest. Backup is disabled
 * globally in the manifest, so even adb-restore can't lift the wrapped blobs.
 */
class PairedDeviceStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun load(): PairedDevice? {
        val json = prefs.getString(KEY_PAIRED, null) ?: return null
        return runCatching { Json.decodeFromString<PairedDevice>(json) }.getOrNull()
    }

    fun save(device: PairedDevice) {
        prefs.edit().putString(KEY_PAIRED, Json.encodeToString(device)).apply()
    }

    fun update(transform: (PairedDevice) -> PairedDevice) {
        load()?.let { save(transform(it)) }
    }

    fun clear() {
        prefs.edit().remove(KEY_PAIRED).apply()
    }

    companion object {
        private const val FILE_NAME = "phantom_pair_v1"
        private const val KEY_PAIRED = "paired_device"
    }
}

@Serializable
data class PairedDevice(
    val baseUrl: String,
    val devNoPin: Boolean,
    val deviceId: String,
    val userId: String,
    val username: String,
    val deviceJwt: String,
    val expiresAt: String,
    /** Base64(NO_WRAP) of the long-term Ed25519 private key (32 bytes). */
    val deviceEd25519Priv: String,
    val deviceEd25519Pub: String,
) {
    fun privRaw(): ByteArray = Base64.decode(deviceEd25519Priv, Base64.NO_WRAP or Base64.NO_PADDING)
}
