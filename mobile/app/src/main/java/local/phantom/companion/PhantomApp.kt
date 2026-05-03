package local.phantom.companion

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import local.phantom.companion.data.AppContainer
import local.phantom.companion.service.PhantomLinkService

/**
 * App-level singletons live on a hand-rolled [AppContainer] rather than Hilt.
 * Tier 1 has fewer than ten DI nodes; the indirection cost of a code-gen DI
 * graph is not worth the build-time penalty on this Radxa aarch64 host.
 *
 * The notification channel is registered here so [PhantomLinkService] can
 * `startForeground` the moment ROOT toggles "stay paired" without a race
 * against channel creation.
 */
class PhantomApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        container = AppContainer(this)
        registerLinkChannel()
    }

    private fun registerLinkChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            PhantomLinkService.CHANNEL_ID,
            getString(R.string.link_service_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.link_service_channel_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        @Volatile
        private var instance: PhantomApp? = null

        fun container(): AppContainer = instance!!.container
    }
}
