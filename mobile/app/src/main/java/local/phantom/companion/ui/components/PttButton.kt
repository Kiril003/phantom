package local.phantom.companion.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.R
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.ui.theme.LocalStateAccent

enum class PttState { Idle, Capturing, AwaitingFinal, Speaking }

@Composable
fun PttButton(
    modifier: Modifier = Modifier,
    state: PttState,
    audioLevel: Float = 0f,
    onPress: () -> Unit,
    onRelease: () -> Unit,
) {
    val theme = LocalPhantomTheme.current
    val accent = LocalStateAccent.current

    val pulseTransition = rememberInfiniteTransition(label = "ptt-pulse")
    val pulseAlpha by pulseTransition.animateFloat(
        initialValue = 0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ptt-pulse-anim",
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(132.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        listOf(
                            accent.color.copy(alpha = if (state == PttState.Idle) 0.7f else 1f),
                            accent.color.copy(alpha = 0.25f),
                        ),
                    ),
                )
                .pointerInput(Unit) {
                    detectTapGestures(
                        onPress = {
                            onPress()
                            try {
                                tryAwaitRelease()
                            } finally {
                                onRelease()
                            }
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            // Audio-reactive outer ring during capture; pulse during AwaitingFinal.
            Canvas(modifier = Modifier.size(132.dp)) {
                val ringAlpha = when (state) {
                    PttState.Idle -> 0.55f
                    PttState.Capturing -> 0.85f
                    PttState.AwaitingFinal -> pulseAlpha
                    PttState.Speaking -> 1f
                }
                val ringScale = when (state) {
                    PttState.Capturing -> 0.96f + audioLevel.coerceIn(0f, 1f) * 0.18f
                    PttState.Speaking -> 1.10f
                    else -> 1.0f
                }
                drawCircle(
                    color = Color.White.copy(alpha = ringAlpha),
                    radius = (size.minDimension / 2f) * ringScale,
                    style = Stroke(width = 4f),
                )
            }
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(theme.surfaceBase.copy(alpha = 0.85f)),
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        val labelId = when (state) {
            PttState.Idle -> R.string.ptt_hold
            PttState.Capturing -> R.string.ptt_capturing
            PttState.AwaitingFinal -> R.string.ptt_awaiting
            PttState.Speaking -> R.string.ptt_speaking
        }
        Text(
            text = androidx.compose.ui.res.stringResource(labelId),
            color = theme.ink,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            letterSpacing = 2.sp,
        )
    }
}
