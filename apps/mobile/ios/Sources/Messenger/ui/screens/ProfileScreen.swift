// ProfileScreen.swift — профиль пользователя.
// Зеркало ProfileScreen.kt (Android/Desktop).

import SwiftUI

struct ProfileScreen: View {
    @EnvironmentObject var vm: AppViewModel
    @State private var showLogoutAlert = false
    @State private var showChangeServer = false

    var body: some View {
        Form {
            Section("Аккаунт") {
                LabeledContent("Пользователь", value: vm.authState.username)
            }

            Section("Безопасность") {
                NavigationLink("Сменить пароль") {
                    ChangePasswordView()
                }
            }

            AppLockSection()
            PrivacyScreenSection()

            Section("Сервер") {
                Button("Сменить сервер") {
                    showChangeServer = true
                }
                .foregroundStyle(.blue)
            }

            Section("Приложение") {
                NavigationLink("Загрузки и обновления") {
                    DownloadsScreen()
                }
                NavigationLink("Администрирование") {
                    AdminScreen()
                }
            }

            Section {
                Button("Выйти", role: .destructive) {
                    showLogoutAlert = true
                }
            }
        }
        .navigationTitle("Профиль")
        .alert("Выйти из аккаунта?", isPresented: $showLogoutAlert) {
            Button("Выйти", role: .destructive) {
                Task { await vm.logout() }
            }
            Button("Отмена", role: .cancel) {}
        }
        .sheet(isPresented: $showChangeServer) {
            NavigationStack {
                ChangeServerView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Отмена") { showChangeServer = false }
                        }
                    }
            }
        }
    }
}

// MARK: - App lock

private struct AppLockSection: View {
    @StateObject private var lockStore = BiometricLockStore.shared
    @State private var showChangePIN = false
    @State private var newPIN = ""
    @State private var pinError = ""

    var body: some View {
        Section("Блокировка приложения") {
            Toggle("Включить PIN-блокировку", isOn: Binding(
                get: { lockStore.settings.enabled },
                set: { lockStore.saveSettings(AppLockSettings(
                    enabled: $0,
                    relockTimeoutSeconds: lockStore.settings.relockTimeoutSeconds,
                    pinHashSha256: lockStore.settings.pinHashSha256
                )) }
            ))
            if lockStore.settings.enabled {
                Button("Изменить PIN") { showChangePIN = true; newPIN = ""; pinError = "" }
            }
        }
        .sheet(isPresented: $showChangePIN) {
            VStack(spacing: 20) {
                Text("Новый PIN").font(.title2.bold())
                SecureField("PIN (минимум 4 символа)", text: $newPIN)
                    .textFieldStyle(.roundedBorder).frame(maxWidth: 240)
                if !pinError.isEmpty {
                    Text(pinError).font(.caption).foregroundStyle(.red)
                }
                HStack {
                    Button("Отмена") { showChangePIN = false }.buttonStyle(.bordered)
                    Button("Сохранить") {
                        guard newPIN.count >= 4 else { pinError = "Минимум 4 символа"; return }
                        lockStore.updatePin(newPIN)
                        showChangePIN = false
                    }.buttonStyle(.borderedProminent)
                }
            }
            .padding(32)
        }
    }
}

// MARK: - Change password

private struct ChangePasswordView: View {
    @EnvironmentObject var vm: AppViewModel
    @State private var current = ""
    @State private var newPwd  = ""
    @State private var confirm = ""
    @State private var error: String? = nil
    @State private var success = false

    var body: some View {
        Form {
            Section("Смена пароля") {
                SecureField("Текущий пароль", text: $current)
                SecureField("Новый пароль",   text: $newPwd)
                SecureField("Подтверждение",  text: $confirm)
            }
            if let err = error { Section { Text(err).foregroundStyle(.red) } }
            if success { Section { Text("Пароль изменён").foregroundStyle(.green) } }
            Section {
                Button("Сохранить") { save() }
                    .disabled(current.isEmpty || newPwd.isEmpty || newPwd != confirm)
            }
        }
        .navigationTitle("Смена пароля")
    }

    private func save() {
        guard newPwd == confirm else { error = "Пароли не совпадают"; return }
        guard newPwd.count >= 8 else { error = "Минимум 8 символов"; return }
        error = nil
        success = false
        Task {
            do {
                try await vm.changePassword(currentPassword: current, newPassword: newPwd)
                success = true
                current = ""
                newPwd = ""
                confirm = ""
            } catch {
                self.error = "Не удалось сменить пароль: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Change server

private struct ChangeServerView: View {
    @EnvironmentObject var vm: AppViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""

    var body: some View {
        Form {
            Section("Новый адрес сервера") {
                TextField("https://", text: $urlText)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            Section {
                Button("Подключиться") {
                    let u = urlText.trimmingCharacters(in: .whitespaces)
                    guard u.hasPrefix("http") else { return }
                    Task {
                        await vm.logout()
                        vm.configureServer(url: u)
                        dismiss()
                    }
                }
                .disabled(urlText.isEmpty)
            }
        }
        .navigationTitle("Сменить сервер")
    }
}

// MARK: - Privacy screen

private struct PrivacyScreenSection: View {
    @StateObject private var privacyStore = PrivacyScreenStore.shared

    var body: some View {
        Section("Экран конфиденциальности") {
            Toggle("Скрывать контент в switcher", isOn: Binding(
                get: { privacyStore.privacyScreenEnabled },
                set: { if $0 { privacyStore.enable() } else { privacyStore.disable() } }
            ))
            Text("Контент скрывается при переключении задач")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
