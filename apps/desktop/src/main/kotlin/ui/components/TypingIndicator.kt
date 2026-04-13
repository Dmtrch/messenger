package ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun TypingIndicator(users: Set<String>) {
    if (users.isEmpty()) return
    val text = if (users.size == 1) "${users.first()} печатает..."
               else "${users.joinToString(", ")} печатают..."
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
}
