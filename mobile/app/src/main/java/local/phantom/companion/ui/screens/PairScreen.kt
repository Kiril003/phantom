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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import java.util.concurrent.atomic.AtomicBoolean
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
    // Visible scan status — feedback the operator was missing earlier when
    // ZXing failed to decode (rowStride bug). Even now that the decoder is
    // fixed, surfacing "знайшов QR" → "з'єднуюсь" → claim error is what
    // turns "0 reactions" into a debuggable flow.
    var scanStatus by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        if (!hasCamera) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    // The screen now scrolls vertically — earlier the "З'єднати" button
    // sat below the fold on 6" portrait devices and the operator never
    // saw it after pasting JSON.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pair_title),
            color = theme.ink,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pair_subtitle),
            color = theme.inkSecondary,
            fontSize = 13.sp,
        )

        GlassCard(
            modifier = Modifier
                .fillMaxWidth()
                .height(320.dp),
            level = GlassLevel.Card,
            accentBorder = true,
        ) {
            if (hasCamera) {
                QrCameraSurface(
                    modifier = Modifier.fillMaxSize(),
                    onScan = { json ->
                        scanStatus = "Знайшов QR, з'єднуюсь…"
                        onClaimFromJson(json)
                    },
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

        // Status row — sits between camera and manual paste, gives the
        // operator a live signal that the camera path is alive.
        if (scanStatus != null || state.pairError != null) {
            Text(
                text = state.pairError ?: scanStatus.orEmpty(),
                color = if (state.pairError != null) theme.coral else theme.ink,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        Text(
            text = "Або вручну",
            color = theme.inkSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
        )
        OutlinedTextField(
            value = manualJson,
            onValueChange = { manualJson = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(androidx.compose.ui.res.stringResource(R.string.pair_paste)) },
            placeholder = { Text("{ \"v\": 1, \"host\": …", color = theme.inkSecondary) },
            singleLine = false,
            minLines = 3,
            maxLines = 6,
        )
        Button(
            onClick = {
                val v = manualJson.trim()
                if (v.isNotBlank()) {
                    scanStatus = "З'єднуюсь з phantom-os…"
                    onClaimFromJson(v)
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            enabled = manualJson.isNotBlank(),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.pair_claim),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        TextButton(onClick = onPair) {
            Text(text = androidx.compose.ui.res.stringResource(R.string.pair_scan_again))
        }

        Spacer(modifier = Modifier.height(20.dp))
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
    // Single-shot guard: ZXing returns the same code every frame at 30 fps,
    // so without this we'd fire onScan dozens of times before the VM
    // transitions state and the operator hears about it.
    val fired = remember { AtomicBoolean(false) }

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
                        if (fired.get()) return@setAnalyzer
                        val text = decodeQr(proxy, reader)
                        if (text != null && fired.compareAndSet(false, true)) {
                            onScan(text)
                        }
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

/**
 * Decode QR from a YUV_420_888 [ImageProxy].
 *
 * CameraX delivers a Y plane that may have **rowStride > width** (padding
 * for hardware alignment). Naively reading `buffer.remaining()` bytes
 * gives ZXing a luminance grid where every row is shifted, which decodes
 * as garbage even though a stand-alone scanner reads the same QR fine.
 * We copy strictly `width * height` bytes, skipping the row padding.
 */
private fun decodeQr(proxy: ImageProxy, reader: MultiFormatReader): String? {
    val plane = proxy.planes.firstOrNull() ?: return null
    val width = proxy.width
    val height = proxy.height
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val buffer = plane.buffer.duplicate()
    buffer.rewind()

    val data = if (rowStride == width && pixelStride == 1) {
        // Lucky path — flat plane, no per-row padding.
        ByteArray(buffer.remaining()).also { buffer.get(it) }
    } else {
        // Per-row copy: skip the trailing stride padding for each row,
        // and step by pixelStride to drop interleaved Cb/Cr if any
        // (rare for plane[0] but safe).
        val out = ByteArray(width * height)
        val rowBuf = ByteArray(rowStride)
        var outPos = 0
        for (y in 0 until height) {
            val toRead = minOf(rowStride, buffer.remaining())
            buffer.get(rowBuf, 0, toRead)
            if (pixelStride == 1) {
                System.arraycopy(rowBuf, 0, out, outPos, width)
            } else {
                var x = 0
                var i = 0
                while (x < width) {
                    out[outPos + x] = rowBuf[i]
                    x += 1
                    i += pixelStride
                }
            }
            outPos += width
        }
        out
    }

    val source = PlanarYUVLuminanceSource(
        data, width, height, 0, 0, width, height, false,
    )
    val bitmap = BinaryBitmap(HybridBinarizer(source))
    return runCatching { reader.decodeWithState(bitmap).text }.getOrNull()
        ?: runCatching {
            reader.reset()
            reader.decode(bitmap).text
        }.getOrNull()
}
