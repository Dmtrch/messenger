// LinkDeviceScreen.swift — экран привязки устройства по токену.
// Зеркало LinkDeviceScreen.kt (Android/Desktop).

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct LinkDeviceScreen: View {
    @EnvironmentObject var vm: AppViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var token = ""
    @State private var deviceName: String = {
#if canImport(UIKit)
        return UIDevice.current.name
#else
        return "iOS device"
#endif
    }()
    @State private var isLoading = false
    @State private var errorText: String? = nil

    var body: some View {
        Form {
            Section("Токен привязки") {
                TextField("Вставьте токен из QR-кода", text: $token)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Section("Имя устройства") {
                TextField("Имя устройства", text: $deviceName)
                    .autocorrectionDisabled()
            }

            if let err = errorText {
                Section { Text(err).foregroundStyle(.red) }
            }

            Section {
                Button {
                    Task { await activate() }
                } label: {
                    if isLoading { ProgressView() } else { Text("Подключить") }
                }
                .disabled(token.isEmpty || deviceName.isEmpty || isLoading)
            }
        }
        .navigationTitle("Привязать устройство")
    }

    private func activate() async {
        isLoading = true
        errorText = nil
        do {
            try await vm.activateDeviceLink(token: token.trimmingCharacters(in: .whitespacesAndNewlines),
                                            deviceName: deviceName)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }
}
