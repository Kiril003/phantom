package local.phantom.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.R
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.screens.CommsScreen
import local.phantom.companion.ui.screens.MapScreen
import local.phantom.companion.ui.screens.PulseScreen
import local.phantom.companion.ui.screens.VaultScreen
import local.phantom.companion.ui.screens.VoiceScreen
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.ui.theme.LocalStateAccent
import local.phantom.companion.ui.theme.stateAccentForSunrise
import local.phantom.companion.vm.NavTab
import local.phantom.companion.vm.PhantomViewModel
import local.phantom.companion.vm.UiState

@Composable
fun PhantomNav(state: UiState, vm: PhantomViewModel) {
    val theme = LocalPhantomTheme.current
    val accent = stateAccentForSunrise(state.systemState)
    androidx.compose.runtime.CompositionLocalProvider(LocalStateAccent provides accent) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(theme.surfaceBase),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                when (state.tab) {
                    NavTab.Pulse -> PulseScreen(state, vm::unpair)
                    NavTab.Voice -> VoiceScreen(state, vm::setPtt)
                    NavTab.Map -> MapScreen(state)
                    NavTab.Comms -> CommsScreen(state)
                    NavTab.Vault -> VaultScreen(state)
                }
            }
            BottomBar(current = state.tab, onSelect = vm::setTab)
        }
    }
}

@Composable
private fun BottomBar(current: NavTab, onSelect: (NavTab) -> Unit) {
    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .height(80.dp),
        level = GlassLevel.Panel,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NavCell(R.string.tab_pulse, Icons.Filled.Bolt, NavTab.Pulse, current, onSelect)
            NavCell(R.string.tab_voice, Icons.Filled.Mic, NavTab.Voice, current, onSelect)
            NavCell(R.string.tab_map, Icons.Filled.Map, NavTab.Map, current, onSelect)
            NavCell(R.string.tab_comms, Icons.Filled.Chat, NavTab.Comms, current, onSelect)
            NavCell(R.string.tab_vault, Icons.Filled.Lock, NavTab.Vault, current, onSelect)
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.NavCell(
    labelRes: Int,
    icon: ImageVector,
    tab: NavTab,
    current: NavTab,
    onSelect: (NavTab) -> Unit,
) {
    val theme = LocalPhantomTheme.current
    val accent = LocalStateAccent.current
    val isSelected = tab == current
    Column(
        modifier = Modifier
            .weight(1f)
            .padding(4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (isSelected) accent.color.copy(alpha = 0.2f) else androidx.compose.ui.graphics.Color.Transparent)
            .padding(8.dp)
            .pointerInput(tab) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.changes.first().pressed) onSelect(tab)
                    }
                }
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (isSelected) accent.color else theme.inkSecondary,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(labelRes),
            color = if (isSelected) theme.ink else theme.inkSecondary,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            fontSize = 11.sp,
            letterSpacing = 1.sp,
        )
    }
}
