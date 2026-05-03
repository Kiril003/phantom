package local.phantom.companion.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import local.phantom.companion.ui.theme.LocalStateAccent

/**
 * OrbView — design §2.2. State-coloured radial breath with an audio-reactive
 * outer ring. Rendering stays inside `Canvas` so we never inflate a separate
 * View; on Android 11 (the minSdk floor) this comes in well under 16 ms/frame.
 */
@Composable
fun OrbView(
    modifier: Modifier = Modifier,
    audioLevel: Float = 0f,
) {
    val accent = LocalStateAccent.current
    val transition = rememberInfiniteTransition(label = "orb-breath")
    val breath by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = (2000 / accent.motionScale).toInt().coerceAtLeast(400),
                easing = LinearEasing,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "orb-breath-anim",
    )

    Canvas(modifier = modifier) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val baseRadius = (minOf(size.width, size.height) / 2f) * 0.85f * breath
        val brush = Brush.radialGradient(
            colors = listOf(
                accent.color.copy(alpha = 0.85f),
                accent.color.copy(alpha = 0.35f),
                Color.Transparent,
            ),
            center = androidx.compose.ui.geometry.Offset(cx, cy),
            radius = baseRadius,
        )
        drawCircle(brush = brush, radius = baseRadius, center = androidx.compose.ui.geometry.Offset(cx, cy))
        // Audio-reactive ring. Always drawn faintly even at level 0 so the orb
        // has a visible silhouette during SHADOW/DREAM (low motion-scale).
        val ringRadius = baseRadius * (1f + audioLevel.coerceIn(0f, 1f) * 0.18f)
        drawCircle(
            color = accent.color.copy(alpha = 0.55f),
            radius = ringRadius,
            center = androidx.compose.ui.geometry.Offset(cx, cy),
            style = Stroke(width = 4f),
        )
    }
}
