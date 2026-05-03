package local.phantom.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import local.phantom.companion.ui.PhantomNav
import local.phantom.companion.ui.screens.PairScreen
import local.phantom.companion.ui.theme.PhantomTheme
import local.phantom.companion.vm.PhantomViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PhantomTheme {
                PhantomRoot()
            }
        }
    }

    @Composable
    private fun PhantomRoot() {
        val vm: PhantomViewModel = viewModel(factory = PhantomViewModel.Factory)
        val state by vm.state.collectAsState()
        Surface(modifier = Modifier.fillMaxSize()) {
            if (state.paired == null) {
                PairScreen(
                    state = state,
                    onPair = vm::beginClaim,
                    onClaimFromJson = vm::claimFromQrJson,
                )
            } else {
                PhantomNav(state = state, vm = vm)
            }
        }
    }
}
