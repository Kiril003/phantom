package local.phantom.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.R
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.UiState

@Composable
fun VaultScreen(state: UiState) {
    val theme = LocalPhantomTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.vault_locked),
            color = theme.ink,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
        GlassCard(modifier = Modifier.fillMaxWidth(), level = GlassLevel.Card) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "GHOST · LOCAL ONLY",
                    color = theme.inkSecondary,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 1.5.sp,
                    fontSize = 11.sp,
                )
                Text(
                    text = "Записи з’являться після першого розблокування біометрією. Розблоковує тільки власник.",
                    color = theme.ink,
                    fontStyle = FontStyle.Italic,
                    fontSize = 13.sp,
                )
            }
        }
    }
}
