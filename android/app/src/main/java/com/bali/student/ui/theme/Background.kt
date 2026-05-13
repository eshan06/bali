package com.bali.student.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush

@Composable
fun BaliBackground(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDash)
            .background(
                Brush.radialGradient(
                    colors = listOf(BrandBlueTint, BgDash),
                    center = Offset(x = 200f, y = 100f),
                    radius = 1400f,
                ),
            ),
    ) {
        content()
    }
}
