package local.phantom.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.net.LinkStatus
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.components.OrbView
import local.phantom.companion.ui.components.StatePill
import local.phantom.companion.ui.components.VitalsRow
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.UiState

@Composable
fun PulseScreen(state: UiState, onUnpair: () -> Unit) {
    val theme = LocalPhantomTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        VitalsRow(
            modifier = Modifier.fillMaxWidth(),
            bpm = state.bpm,
            breathBpm = state.breath,
            stress = state.stress,
        )
        OrbView(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp),
        )
        StatePill(modifier = Modifier.fillMaxWidth(), standingOrders = 0)
        GlassCard(modifier = Modifier.fillMaxWidth(), level = GlassLevel.Card) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "NEXT 1H",
                    color = theme.inkSecondary,
                    fontSize = 11.sp,
                    letterSpacing = 1.5.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(modifier = Modifier.size(6.dp))
                Text(
                    text = "phantom тримає ефір. Попроси прогноз — і він перерахує тіло, погоду, плани.",
                    color = theme.ink,
                    fontStyle = FontStyle.Italic,
                    fontSize = 14.sp,
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Користувач: ${state.paired?.username ?: "—"}",
            color = theme.inkSecondary,
            fontSize = 12.sp,
        )
        Text(
            text = when (state.linkStatus) {
                LinkStatus.Connected -> "Канал онлайн"
                LinkStatus.Connecting -> "Перепідключення…"
                LinkStatus.Disconnected -> "Офлайн"
            },
            color = theme.inkSecondary,
            fontSize = 12.sp,
        )
        Spacer(modifier = Modifier.fillMaxWidth().height(1.dp))
        TextButton(
            onClick = onUnpair,
            modifier = Modifier.align(Alignment.Start),
        ) {
            Text(text = "Розпарити пристрій", color = theme.coral)
        }
    }
}
