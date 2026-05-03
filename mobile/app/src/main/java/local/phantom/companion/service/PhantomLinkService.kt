package local.phantom.companion.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import local.phantom.companion.MainActivity
import local.phantom.companion.PhantomApp
import local.phantom.companion.R

/**
 * Persistent foreground service holding the WS link to phantom-os alive.
 *
 * Lifecycle: started after a successful pairing (or on subsequent app
 * launches if pairing data is present). Restarted by the system after
 * doze; reconnect backoff lives inside [local.phantom.companion.net.PhantomLink].
 *
 * On Android 14, foreground services with type `dataSync` must declare
 * `FOREGROUND_SERVICE_DATA_SYNC` and finish a sync within ~6 hours unless
 * promoted to a different type. The link service explicitly stops itself
 * when the user unpairs from the Pulse screen.
 */
class PhantomLinkService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as PhantomApp).container
        startForeground(NOTIF_ID, buildNotification())
        container.link.start()
        return START_STICKY
    }

    override fun onDestroy() {
        val container = (application as PhantomApp).container
        container.link.stop()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getActivity(this, 0, intent, flags)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.link_service_status_connected))
            .setOngoing(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "phantom_link_v1"
        const val NOTIF_ID = 4201
    }
}
