package ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import store.CallStatus
import store.CallState

@Composable
fun CallOverlay(
    call: CallState,
    callerName: String,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onHangUp: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.TopCenter,
    ) {
        Surface(
            modifier = Modifier
                .padding(top = 16.dp)
                .widthIn(max = 360.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            shadowElevation = 8.dp,
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                when (call.status) {
                    CallStatus.RINGING_IN -> IncomingCall(
                        callerName = callerName,
                        onAccept = onAccept,
                        onReject = onReject,
                    )
                    CallStatus.RINGING_OUT -> OutgoingCall(
                        callerName = callerName,
                        onHangUp = onHangUp,
                    )
                    CallStatus.ACTIVE -> ActiveCall(
                        callerName = callerName,
                        onHangUp = onHangUp,
                    )
                    CallStatus.IDLE -> Unit
                }
            }
        }
    }
}

@Composable
private fun IncomingCall(callerName: String, onAccept: () -> Unit, onReject: () -> Unit) {
    Text("Входящий звонок", style = MaterialTheme.typography.labelMedium)
    Text(callerName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text(
        "Голосовой звонок",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.outline,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        FloatingActionButton(
            onClick = onReject,
            containerColor = MaterialTheme.colorScheme.error,
        ) {
            Icon(Icons.Default.Close, contentDescription = "Отклонить", tint = Color.White)
        }
        FloatingActionButton(
            onClick = onAccept,
            containerColor = Color(0xFF4CAF50),
        ) {
            Icon(Icons.Default.Call, contentDescription = "Принять", tint = Color.White)
        }
    }
}

@Composable
private fun OutgoingCall(callerName: String, onHangUp: () -> Unit) {
    Text("Исходящий звонок", style = MaterialTheme.typography.labelMedium)
    Text(callerName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    PulsingDots()
    FloatingActionButton(
        onClick = onHangUp,
        containerColor = MaterialTheme.colorScheme.error,
    ) {
        Icon(Icons.Default.Close, contentDescription = "Завершить", tint = Color.White)
    }
}

@Composable
private fun ActiveCall(callerName: String, onHangUp: () -> Unit) {
    var seconds by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) { delay(1000); seconds++ }
    }
    Text("Соединён", style = MaterialTheme.typography.labelMedium, color = Color(0xFF4CAF50))
    Text(callerName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text(
        seconds.toCallDuration(),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.outline,
    )
    Text(
        "Медиа недоступно на Desktop",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.outline,
        fontSize = 10.sp,
    )
    FloatingActionButton(
        onClick = onHangUp,
        containerColor = MaterialTheme.colorScheme.error,
    ) {
        Icon(Icons.Default.Close, contentDescription = "Завершить", tint = Color.White)
    }
}

@Composable
private fun PulsingDots() {
    var dots by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        while (true) {
            delay(500)
            dots = when (dots.length) { 0 -> "." ; 1 -> ".." ; else -> "" }
        }
    }
    Text("Вызов$dots", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
}

private fun Int.toCallDuration(): String {
    val m = this / 60
    val s = this % 60
    return "%d:%02d".format(m, s)
}
