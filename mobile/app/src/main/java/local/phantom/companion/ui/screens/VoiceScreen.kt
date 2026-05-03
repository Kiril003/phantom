package local.phantom.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.ui.components.OrbView
import local.phantom.companion.ui.components.PttButton
import local.phantom.companion.ui.components.PttState
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.PttRuntime
import local.phantom.companion.vm.UiState

@Composable
fun VoiceScreen(state: UiState, onPtt: (PttRuntime) -> Unit) {
    val theme = LocalPhantomTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = true),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                OrbView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp),
                    audioLevel = state.ptt.audioLevel,
                )
                Text(
                    text = when (state.ptt.state) {
                        PttState.Idle -> "Готовий слухати"
                        PttState.Capturing -> "Слухаю мікрофон…"
                        PttState.AwaitingFinal -> "Phantom думає…"
                        PttState.Speaking -> "Phantom говорить…"
                    },
                    color = theme.ink,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                )
            }
        }
        Spacer(modifier = Modifier.height(20.dp))
        PttButton(
            modifier = Modifier.fillMaxWidth(),
            state = state.ptt.state,
            audioLevel = state.ptt.audioLevel,
            onPress = { onPtt(PttRuntime(PttState.Capturing)) },
            onRelease = { onPtt(PttRuntime(PttState.AwaitingFinal)) },
        )
    }
}
