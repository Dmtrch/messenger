// ServerSetupScreen.swift — ввод и валидация URL сервера.
// Зеркало ServerSetupScreen.kt (Android/Desktop).

import SwiftUI

struct ServerSetupScreen: View {
    @EnvironmentObject var vm: AppViewModel
    @State private var urlText = ""
    @State private var error: String? = nil
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://messenger.example.com", text: $urlText)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Адрес сервера")
                } footer: {
                    Text("Введите URL вашего самохостинг-сервера Messenger.")
                }

                if let err = error {
                    Section {
                        Text(err).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        connect()
                    } label: {
                        if isLoading {
                            ProgressView()
                        } else {
                            Text("Подключиться")
                        }
                    }
                    .disabled(urlText.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                }
            }
            .navigationTitle("Настройка сервера")
        }
    }

    private func connect() {
        let trimmed = urlText.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") else {
            error = "URL должен начинаться с http:// или https://"
            return
        }
        error = nil
        isLoading = true
        vm.configureServer(url: trimmed)
        isLoading = false
    }
}
