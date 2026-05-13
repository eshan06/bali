package com.bali.student.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val BaliColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = SurfaceCard,
    primaryContainer = BrandBlueTint,
    onPrimaryContainer = BrandBlue,
    background = BgDash,
    onBackground = Ink900,
    surface = SurfaceCard,
    onSurface = Ink900,
    surfaceVariant = BrandBlueTint,
    onSurfaceVariant = Ink600,
    outline = BorderSoft,
    error = AccentRed,
)

@Composable
fun BaliTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = BaliColors,
        typography = BaliTypography,
        content = content,
    )
}
