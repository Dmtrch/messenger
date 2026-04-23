// src/main/kotlin/com/messenger/MainActivity.kt
package com.messenger

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import android.view.WindowManager
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.messenger.store.BiometricLockStore
import com.messenger.store.PrivacyScreenStore
import com.messenger.ui.App
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BiometricLockStore.init(applicationContext)
        PrivacyScreenStore.init(applicationContext)
        applyPrivacyFlag(PrivacyScreenStore.enabled.value)
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
