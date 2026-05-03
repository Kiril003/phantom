package local.phantom.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

/**
 * Compose translation of `docs/MOBILE_COMPANION_DESIGN.md` §1.
 *
 * Material3 colour scheme is filled in with sunrise tokens so widgets we
 * accidentally fall back to (BiometricPrompt skins, system pickers) inherit
 * tones close to the rest of the UI. The real surface for the app is the
 * `PhantomThemeSpec` carried via `LocalPhantomTheme`.
 *
 * State accent (FOCUS / SENTINEL / GHOST / …) is layered on top via
 * `LocalStateAccent` — see [StateAccent]. Components read both: theme tokens
 * for surfaces/text, accent for highlights/motion-scale.
 */
data class PhantomThemeSpec(
    val id: String,
    val primary: Color,
    val primarySoft: Color,
    val primaryDeep: Color,
    val coral: Color,
    val coralDeep: Color,
    val surfaceBase: Color,
    val surfaceDeep: Color,
    val glassPanel: Color,
    val glassBorder: Color,
    val glassHighlight: Color,
    val glowPrimary: Color,
    val ink: Color,
    val inkSecondary: Color,
)

val SunriseWarm = PhantomThemeSpec(
    id = "sunrise-warm",
    primary = Color(0xFFF4AF25),
    primarySoft = Color(0xFFFBC66A),
    primaryDeep = Color(0xFFB07A10),
    coral = Color(0xFFEF4444),
    coralDeep = Color(0xFFB9201F),
    surfaceBase = Color(0xFFF8F7F5),
    surfaceDeep = Color(0xFFF5F1EA),
    glassPanel = Color(0x99FFFFFF),
    glassBorder = Color(0x33B07A10),
    glassHighlight = Color(0x40FFFFFF),
    glowPrimary = Color(0x4DF4AF25),
    ink = Color(0xFF1A150D),
    inkSecondary = Color(0xFF6B5B3F),
)

val AmberNight = PhantomThemeSpec(
    id = "amber-night",
    primary = Color(0xFFF4AF25),
    primarySoft = Color(0xFFFBC66A),
    primaryDeep = Color(0xFFFFC34A),
    coral = Color(0xFFE35858),
    coralDeep = Color(0xFF7F1D1D),
    surfaceBase = Color(0xFF0E0A05),
    surfaceDeep = Color(0xFF080502),
    glassPanel = Color(0xA6140F08),
    glassBorder = Color(0x40F4AF25),
    glassHighlight = Color(0x33FFFFFF),
    glowPrimary = Color(0x73F4AF25),
    ink = Color(0xFFF6E9CF),
    inkSecondary = Color(0xFFB7A57A),
)

val LocalPhantomTheme = compositionLocalOf { SunriseWarm }

@Composable
fun PhantomTheme(
    spec: PhantomThemeSpec = SunriseWarm,
    content: @Composable () -> Unit,
) {
    val isDark = spec.id == "amber-night"
    val materialColors = if (isDark) {
        darkColorScheme(
            primary = spec.primary,
            onPrimary = Color.Black,
            background = spec.surfaceBase,
            onBackground = spec.ink,
            surface = spec.surfaceDeep,
            onSurface = spec.ink,
            secondary = spec.coral,
        )
    } else {
        lightColorScheme(
            primary = spec.primary,
            onPrimary = Color.White,
            background = spec.surfaceBase,
            onBackground = spec.ink,
            surface = spec.surfaceDeep,
            onSurface = spec.ink,
            secondary = spec.coral,
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalPhantomTheme provides spec) {
        MaterialTheme(
            colorScheme = materialColors,
            typography = phantomTypography(),
            content = content,
        )
    }
}

private fun phantomTypography(): androidx.compose.material3.Typography {
    // Bundled Manrope-fetch lives in Phase 2 (GoogleFont provider). Tier 1
    // ships with system default + FontFamily.SansSerif so we don't bloat the
    // APK with font assets before pairing flow is even validated. Substituting
    // Manrope later is a one-line change in this builder.
    val base = androidx.compose.material3.Typography()
    val sans = FontFamily.SansSerif
    return base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = sans),
        displayMedium = base.displayMedium.copy(fontFamily = sans),
        displaySmall = base.displaySmall.copy(fontFamily = sans),
        headlineLarge = base.headlineLarge.copy(fontFamily = sans),
        headlineMedium = base.headlineMedium.copy(fontFamily = sans),
        headlineSmall = base.headlineSmall.copy(fontFamily = sans),
        titleLarge = base.titleLarge.copy(fontFamily = sans),
        titleMedium = base.titleMedium.copy(fontFamily = sans),
        titleSmall = base.titleSmall.copy(fontFamily = sans),
        bodyLarge = base.bodyLarge.copy(fontFamily = sans),
        bodyMedium = base.bodyMedium.copy(fontFamily = sans),
        bodySmall = base.bodySmall.copy(fontFamily = sans),
        labelLarge = base.labelLarge.copy(fontFamily = sans),
        labelMedium = base.labelMedium.copy(fontFamily = sans),
        labelSmall = base.labelSmall.copy(fontFamily = sans),
    )
}
