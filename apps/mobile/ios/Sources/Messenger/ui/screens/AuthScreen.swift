// AuthScreen.swift — экран входа и регистрации.
// Зеркало AuthScreen.kt (Android/Desktop).

import SwiftUI

struct AuthScreen: View {
    @EnvironmentObject var vm: AppViewModel
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorText: String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section("Учётные данные") {
                    TextField("Имя пользователя", text: $username)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    SecureField("Пароль", text: $password)
                }

                if let err = errorText {
                    Section { Text(err).foregroundStyle(.red) }
                }

                Section {
                    Button {
                        Task { await login() }
                    } label: {
                        if isLoading {
                            ProgressView()
                        } else {
                            Text("Войти")
                        }
                    }
                    .disabled(username.isEmpty || password.isEmpty || isLoading)
                }

                Section {
                    NavigationLink("Привязать это устройство по токену") {
                        LinkDeviceScreen()
                    }
                }
            }
            .navigationTitle("Вход")
        }
    }

    private func login() async {
        isLoading = true
        errorText = nil
        do {
            try await vm.login(username: username, password: password)
            UserDefaults.standard.set(username, forKey: "messenger.username")
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }
}
