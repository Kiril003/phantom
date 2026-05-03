package local.phantom.companion.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview as CameraPreview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import local.phantom.companion.R
import local.phantom.companion.ui.components.GlassCard
import local.phantom.companion.ui.components.GlassLevel
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.vm.UiState

@Composable
fun PairScreen(
    state: UiState,
    onPair: () -> Unit,
    onClaimFromJson: (String) -> Unit,
) {
    val theme = LocalPhantomTheme.current
    val context = LocalContext.current
    var hasCamera by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCamera = granted }

    var manualJson by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        if (!hasCamera) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pair_title),
            color = theme.ink,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pair_subtitle),
            color = theme.inkSecondary,
            fontSize = 14.sp,
        )

        GlassCard(
            modifier = Modifier
                .fillMaxWidth()
                .height(360.dp),
            level = GlassLevel.Card,
            accentBorder = true,
        ) {
            if (hasCamera) {
                QrCameraSurface(
                    modifier = Modifier.fillMaxSize(),
                    onScan = { onClaimFromJson(it) },
                )
            } else {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.pair_camera_denied),
                        color = theme.ink,
                    )
                }
            }
        }

        OutlinedTextField(
            value = manualJson,
            onValueChange = { manualJson = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(androidx.compose.ui.res.stringResource(R.string.pair_paste)) },
            singleLine = false,
        )
        Button(
            onClick = {
                val v = manualJson.trim()
                if (v.isNotBlank()) onClaimFromJson(v)
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = manualJson.isNotBlank(),
        ) {
            Text(text = androidx.compose.ui.res.stringResource(R.string.pair_claim))
        }
        TextButton(onClick = onPair) {
            Text(text = androidx.compose.ui.res.stringResource(R.string.pair_scan_again))
        }

        if (state.pairError != null) {
            Text(text = state.pairError, color = theme.coral)
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun QrCameraSurface(
    modifier: Modifier = Modifier,
    onScan: (String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val reader = remember { MultiFormatReader() }

    LaunchedEffect(previewView) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener(
            {
                val cameraProvider = cameraProviderFuture.get()
                val preview = CameraPreview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setTargetResolution(Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { proxy: ImageProxy ->
                    try {
                        val text = decodeQr(proxy, reader)
                        if (text != null) onScan(text)
                    } finally {
                        proxy.close()
                    }
                }
                runCatching {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    AndroidView(
        modifier = modifier,
        factory = { previewView },
    )
}

private fun decodeQr(proxy: ImageProxy, reader: MultiFormatReader): String? {
    val plane = proxy.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val data = ByteArray(buffer.remaining())
    buffer.get(data)
    val width = proxy.width
    val height = proxy.height
    val source = PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
    val bitmap = BinaryBitmap(HybridBinarizer(source))
    return runCatching { reader.decodeWithState(bitmap).text }.getOrNull()
        ?: runCatching { reader.decode(bitmap).text }.getOrNull()
}
