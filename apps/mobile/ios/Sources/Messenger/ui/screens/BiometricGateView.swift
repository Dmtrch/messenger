// BiometricGateView.swift — экран блокировки с биометрией / PIN.
// NSFaceIDUsageDescription должен быть добавлен в Info.plist Xcode-проекта.

import SwiftUI
import LocalAuthentication

struct BiometricGateView: View {
    let onUnlocked: () -> Void

    @State private var pin = ""
    @State private var errorText = ""
    @State private var showPIN = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)

            Text("Разблокировать Messenger")
                .font(.title2.bold())

            if showPIN {
                VStack(spacing: 12) {
                    SecureField("PIN-код", text: $pin)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 220)

                    if !errorText.isEmpty {
                        Text(errorText)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Button("Войти") {
                        guard pin.count >= 4 else {
                            errorText = "PIN должен содержать не менее 4 символов"
                            return
                        }
                        if BiometricLockStore.shared.isPinCorrect(pin) {
                            BiometricLockStore.shared.unlock()
                            onUnlocked()
                        } else {
                            errorText = "Неверный PIN"
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            Button(showPIN ? "Использовать биометрию" : "Использовать PIN") {
                if showPIN {
                    triggerBiometrics()
                } else {
                    showPIN = true
                }
            }
            .font(.subheadline)

            Spacer()
        }
        .padding()
        .onAppear { triggerBiometrics() }
    }

    private func triggerBiometrics() {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            showPIN = true
            return
        }
        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: "Войдите в Messenger"
        ) { success, _ in
            DispatchQueue.main.async {
                if success { onUnlocked() } else { showPIN = true }
            }
        }
    }
}
