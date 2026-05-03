package local.phantom.companion.ui.theme

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * State accent — `docs/MOBILE_COMPANION_DESIGN.md` §1.2.
 *
 * Layered ON TOP of [PhantomThemeSpec]. Components ask `LocalStateAccent` for
 * the highlight colour and motion multiplier; theme tokens still own surface
 * / ink / glass. SystemState is mirrored from the WS `state` channel.
 */
enum class SystemState { SHADOW, FOCUS, DIALOGUE, SENTINEL, GHOST, DREAM }

data class StateAccent(
    val state: SystemState,
    val color: Color,
    val motionScale: Float,
    val uiOpacity: Float,
)

val LocalStateAccent = compositionLocalOf {
    StateAccent(
        state = SystemState.FOCUS,
        color = Color(0xFFB07A10),
        motionScale = 1f,
        uiOpacity = 1f,
    )
}

fun stateAccentForSunrise(state: SystemState): StateAccent = when (state) {
    SystemState.SHADOW -> StateAccent(state, Color(0xFF8A7F72), 0.6f, 0.92f)
    SystemState.FOCUS -> StateAccent(state, Color(0xFFB07A10), 1.0f, 1.0f)
    SystemState.DIALOGUE -> StateAccent(state, Color(0xFFB07A10), 1.1f, 1.0f)
    SystemState.SENTINEL -> StateAccent(state, Color(0xFFB9201F), 1.3f, 1.0f)
    SystemState.GHOST -> StateAccent(state, Color(0xFF16A34A), 0.8f, 0.9f)
    SystemState.DREAM -> StateAccent(state, Color(0xFFB07A10), 0.4f, 0.75f)
}
