package local.phantom.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.UiState

@Composable
fun CommsScreen(state: UiState) {
    val theme = LocalPhantomTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "COMMS",
            color = theme.ink,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
        Spacer(modifier = Modifier.height(4.dp))
        GlassCard(modifier = Modifier.fillMaxWidth(), level = GlassLevel.Card) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("PHANTOM", color = theme.ink, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Чат із Phantom доступний через PTT і скоро з’явиться як окрема сесія тут (Tier 2.5).",
                    color = theme.inkSecondary,
                    fontStyle = FontStyle.Italic,
                    fontSize = 13.sp,
                )
            }
        }
        GlassCard(modifier = Modifier.fillMaxWidth(), level = GlassLevel.Card) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("CALLS / SMS / IM", color = theme.ink, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Telecom-bridge ще не активний. Опція з’явиться у Settings → Communications.",
                    color = theme.inkSecondary,
                    fontStyle = FontStyle.Italic,
                    fontSize = 13.sp,
                )
            }
        }
    }
}
