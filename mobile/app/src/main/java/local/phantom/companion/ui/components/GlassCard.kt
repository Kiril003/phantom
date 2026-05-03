package local.phantom.companion.ui.components

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import local.phantom.companion.ui.theme.LocalPhantomTheme

enum class GlassLevel(val blurDp: Float, val bgAlpha: Float, val cornerDp: Int) {
    Subtle(blurDp = 12f, bgAlpha = 0.40f, cornerDp = 16),
    Panel(blurDp = 12f, bgAlpha = 0.60f, cornerDp = 24),
    Card(blurDp = 24f, bgAlpha = 0.70f, cornerDp = 16),
    Elevated(blurDp = 32f, bgAlpha = 0.78f, cornerDp = 32),
}

/**
 * Glass stack — design §1.4. RenderEffect blur on API 31+; flat tint fallback
 * below that (29-30 devices still get visually layered surfaces, just without
 * background-content blur). The 1px inner highlight + accent border give the
 * card a "cut from glass" silhouette that's recognisable across all paths.
 */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    level: GlassLevel = GlassLevel.Panel,
    accentBorder: Boolean = false,
    content: @Composable BoxScope.() -> Unit,
) {
    val theme = LocalPhantomTheme.current
    val shape = RoundedCornerShape(level.cornerDp.dp)

    val baseModifier = Modifier
        .clip(shape)
        .then(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Modifier.graphicsLayer {
                    renderEffect = RenderEffect
                        .createBlurEffect(level.blurDp, level.blurDp, Shader.TileMode.CLAMP)
                        .asComposeRenderEffect()
                }
            } else {
                Modifier
            },
        )
        .background(theme.glassPanel.copy(alpha = level.bgAlpha))
        .border(
            width = 1.dp,
            color = if (accentBorder) theme.primary else theme.glassBorder,
            shape = shape,
        )
        .drawWithContent {
            drawContent()
            // 1px inner highlight along the top edge — the "lit-from-above"
            // glint that separates a glass surface from a flat tinted box.
            drawLine(
                color = theme.glassHighlight,
                start = Offset(8f, 1f),
                end = Offset(size.width - 8f, 1f),
                strokeWidth = 1f,
            )
        }

    Box(modifier = modifier.then(baseModifier), content = content)
}
