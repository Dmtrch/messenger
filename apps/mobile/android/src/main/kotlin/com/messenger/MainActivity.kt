// src/main/kotlin/com/messenger/MainActivity.kt
package com.messenger

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.messenger.store.BiometricLockStore
import com.messenger.store.PrivacyScreenStore
import com.messenger.ui.App
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* отказ допустим: без push приложение остаётся функциональным */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BiometricLockStore.init(applicationContext)
        PrivacyScreenStore.init(applicationContext)
        applyPrivacyFlag(PrivacyScreenStore.enabled.value)
        requestNotificationPermissionIfNeeded()
        lifecycleScope.launch {
            PrivacyScreenStore.enabled.collect { applyPrivacyFlag(it) }
        }
        setContent {
            val settings by BiometricLockStore.settings.collectAsState()
            val isLocked by BiometricLockStore.isLocked.collectAsState()
            val requiresUnlock = settings.enabled && isLocked
            App(
                application = application,
                requiresBiometricUnlock = requiresUnlock,
                onUnlocked = {
                    BiometricLockStore.unlock()
                },
                onTriggerBiometric = {
                    if (BiometricHelper.isAvailable(this)) {
                        BiometricHelper.prompt(
                            activity = this,
                            onSuccess = {
                                BiometricLockStore.unlock()
                            },
                            onFailed = { /* оставить PIN-экран */ },
                        )
                    }
                }
            )
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun applyPrivacyFlag(enabled: Boolean) {
        if (enabled) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    override fun onResume() {
        super.onResume()
        // При возврате из фона — требуем повторной разблокировки
        // requiresUnlock = true  // раскомментировать для lock-on-background
    }
}
