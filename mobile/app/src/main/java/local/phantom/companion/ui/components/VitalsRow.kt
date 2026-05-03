package local.phantom.companion.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.R
import local.phantom.companion.ui.theme.LocalPhantomTheme

@Composable
fun VitalsRow(
    modifier: Modifier = Modifier,
    bpm: Int? = null,
    breathBpm: Int? = null,
    stress: Float? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(72.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        VitalChip(
            modifier = Modifier.weight(1f),
            label = stringRes(R.string.vitals_bpm),
            value = bpm?.toString() ?: "—",
        )
        VitalChip(
            modifier = Modifier.weight(1f),
            label = stringRes(R.string.vitals_breath),
            value = breathBpm?.toString() ?: "—",
        )
        VitalChip(
            modifier = Modifier.weight(1f),
            label = stringRes(R.string.vitals_stress),
            value = stress?.let { "%.2f".format(it) } ?: "—",
        )
    }
}

@Composable
private fun VitalChip(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
) {
    val theme = LocalPhantomTheme.current
    GlassCard(modifier = modifier, level = GlassLevel.Subtle) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
        ) {
            Text(
                text = label,
                color = theme.inkSecondary,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
                letterSpacing = 1.5.sp,
            )
            Text(
                modifier = Modifier.align(Alignment.BottomStart),
                text = value,
                color = theme.ink,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
            )
        }
    }
}

@Composable
private fun stringRes(id: Int): String =
    androidx.compose.ui.res.stringResource(id = id)
