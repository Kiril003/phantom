package local.phantom.companion.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.UiState

/**
 * Tier 1 placeholder. MapLibre integration lands in Tier 2 (`feature-map`
 * module per design §11), at which point this composable swaps out the
 * GlassCard for an `AndroidView(MapView)` while keeping the layer-pill
 * scaffold above intact.
 */
@Composable
fun MapScreen(state: UiState) {
    val theme = LocalPhantomTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
    ) {
        Text(
            text = "TACTICAL MAP",
            color = theme.ink,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
        Box(modifier = Modifier.padding(top = 16.dp)) {
            GlassCard(
                modifier = Modifier
                    .fillMaxSize(),
                level = GlassLevel.Card,
            ) {
                Box(modifier = Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = "MapLibre + wardriving — Tier 2.\nЗ Phantom-OS поки прийде snapshot геолокації цієї сесії.",
                        color = theme.inkSecondary,
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
}
