package local.phantom.companion.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.phantom.companion.ui.theme.LocalPhantomTheme
import local.phantom.companion.ui.theme.LocalStateAccent

@Composable
fun StatePill(
    modifier: Modifier = Modifier,
    standingOrders: Int = 0,
) {
    val theme = LocalPhantomTheme.current
    val accent = LocalStateAccent.current
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(theme.glassPanel.copy(alpha = 0.6f))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        // 8 dp accent dot — the only chromatic anchor in the pill, telling
        // the user which state the system is in at a glance.
        Spacer(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(accent.color),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = accent.state.name,
            color = theme.ink,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            letterSpacing = 2.sp,
            textAlign = TextAlign.Start,
        )
        if (standingOrders > 0) {
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "· $standingOrders standing orders",
                color = theme.inkSecondary,
                fontSize = 12.sp,
                letterSpacing = 1.sp,
            )
        }
    }
}
