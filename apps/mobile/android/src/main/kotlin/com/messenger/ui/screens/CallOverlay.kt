// src/main/kotlin/com/messenger/ui/screens/CallOverlay.kt
package com.messenger.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.messenger.service.call.AndroidVideoRendererBinding
import com.messenger.store.CallState
import com.messenger.store.CallStatus
import org.webrtc.SurfaceViewRenderer

@Composable
fun CallOverlay(
    callState: CallState,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onHangUp: () -> Unit,
    rendererBinding: AndroidVideoRendererBinding? = null,
    onBindRenderers: () -> Unit = {},
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center,
    ) {
        when (callState.status) {
            CallStatus.RINGING_IN -> IncomingCall(
                fromUserId = callState.remoteUserId,
                onAccept = onAccept,
                onReject = onReject,
            )
            CallStatus.RINGING_OUT -> OutgoingCall(
                toUserId = callState.remoteUserId,
                onCancel = onHangUp,
            )
            CallStatus.ACTIVE -> ActiveCall(
                callState = callState,
                rendererBinding = rendererBinding,
                onHangUp = onHangUp,
                onBindRenderers = onBindRenderers,
            )
            CallStatus.IDLE -> { /* не показываем */ }
        }
    }
}

@Composable
private fun IncomingCall(fromUserId: String, onAccept: () -> Unit, onReject: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Text("Входящий звонок", style = MaterialTheme.typography.headlineSmall, color = Color.White)
        Text(fromUserId, style = MaterialTheme.typography.bodyLarge, color = Color.White)
        Row(horizontalArrangement = Arrangement.spacedBy(48.dp)) {
            FloatingActionButton(
                onClick = onReject,
                containerColor = Color.Red,
                shape = CircleShape,
            ) {
                Icon(Icons.Default.Close, contentDescription = "Отклонить", tint = Color.White)
            }
            FloatingActionButton(
                onClick = onAccept,
                containerColor = Color(0xFF4CAF50),
                shape = CircleShape,
            ) {
                Icon(Icons.Default.Call, contentDescription = "Принять", tint = Color.White)
            }
        }
    }
}

@Composable
private fun OutgoingCall(toUserId: String, onCancel: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 0.8f, targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Text("Исходящий звонок", style = MaterialTheme.typography.headlineSmall, color = Color.White)
        Text(toUserId, style = MaterialTheme.typography.bodyLarge, color = Color.White)
        Box(modifier = Modifier.scale(scale)) {
            Icon(
                Icons.Default.Call,
                contentDescription = null,
                tint = Color(0xFF4CAF50),
                modifier = Modifier.size(64.dp),
            )
        }
        FloatingActionButton(
            onClick = onCancel,
            containerColor = Color.Red,
            shape = CircleShape,
        ) {
            Icon(Icons.Default.Close, contentDescription = "Отменить", tint = Color.White)
        }
    }
}

@Composable
private fun ActiveCall(
    callState: CallState,
    rendererBinding: AndroidVideoRendererBinding?,
    onHangUp: () -> Unit,
    onBindRenderers: () -> Unit,
) {
    var seconds by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            seconds++
        }
    }
    val mins = seconds / 60
    val secs = seconds % 60
    val timer = "%02d:%02d".format(mins, secs)

    if (callState.isVideo && rendererBinding != null) {
        Box(Modifier.fillMaxSize()) {
            // Remote video — занимает весь экран
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).also { renderer ->
                        renderer.init(rendererBinding.eglBase.eglBaseContext, null)
                        rendererBinding.remoteRenderer = renderer
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            // Local preview — маленький inset в правом верхнем углу
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).also { renderer ->
                        renderer.init(rendererBinding.eglBase.eglBaseContext, null)
                        renderer.setMirror(true)
                        rendererBinding.localRenderer = renderer
                    }
                },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp)
                    .size(width = 120.dp, height = 180.dp),
            )

            // Подключить треки после первого фрейма
            LaunchedEffect(Unit) { onBindRenderers() }

            // Таймер + кнопка завершения
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(timer, style = MaterialTheme.typography.displaySmall, color = Color.White)
                FloatingActionButton(
                    onClick = onHangUp,
                    containerColor = Color.Red,
                    shape = CircleShape,
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Завершить", tint = Color.White)
                }
            }

            DisposableEffect(Unit) {
                onDispose {
                    rendererBinding.localRenderer?.release()
                    rendererBinding.localRenderer = null
                    rendererBinding.remoteRenderer?.release()
                    rendererBinding.remoteRenderer = null
                }
            }
        }
    } else {
        // Audio-only режим
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Звонок с ${callState.remoteUserId}",
                style = MaterialTheme.typography.headlineSmall,
                color = Color.White,
            )
            Text(timer, style = MaterialTheme.typography.displaySmall, color = Color.White)
            Spacer(Modifier.height(8.dp))
            FloatingActionButton(
                onClick = onHangUp,
                containerColor = Color.Red,
                shape = CircleShape,
            ) {
                Icon(Icons.Default.Close, contentDescription = "Завершить", tint = Color.White)
            }
        }
    }
}
