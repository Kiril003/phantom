package local.phantom.companion.data

import android.content.Context
import local.phantom.companion.net.PhantomApi
import local.phantom.companion.net.PhantomLink

/**
 * Hand-rolled DI graph. Keeps the dependency wiring obvious in one place
 * without dragging Hilt's annotation-processor into the build (saves
 * ~30 % cold-build time on this Radxa host).
 */
class AppContainer(context: Context) {
    val store: PairedDeviceStore = PairedDeviceStore(context)
    val api: PhantomApi = PhantomApi(store)
    val link: PhantomLink = PhantomLink(api, store)
}
