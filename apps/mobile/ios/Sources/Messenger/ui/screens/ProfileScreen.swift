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

            Section("Сервер") {
                Button("Сменить сервер") {
                    showChangeServer = true
                }
                .foregroundStyle(.blue)
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
        // TODO Step B+: ApiClient.changePassword
        error = nil
        success = true
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
