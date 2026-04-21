// UpdateBannerView.swift
// Баннер обновления приложения для iOS.
// Показывает уведомление "Доступна версия X" с кнопкой "Обновить",
// которая открывает App Store через deep-link.

import SwiftUI

// MARK: - UpdateBannerView

/// Баннер обновления приложения.
/// - При `isForced == true` блокирует весь UI до перехода в App Store.
/// - При `isForced == false` показывает dismissible баннер в верхней части экрана.
struct UpdateBannerView: View {
    let latestVersion: String
    let appStoreUrl: String
    var isForced: Bool = false
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        if isForced {
            forcedOverlay
        } else {
            inlineBanner
        }
    }

    // MARK: - Forced overlay (блокирует UI)

    private var forcedOverlay: some View {
        ZStack {
            Color.black.opacity(0.85)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.blue)

                VStack(spacing: 8) {
                    Text("Требуется обновление")
                        .font(.title2.bold())
                        .foregroundStyle(.white)

                    Text("Версия \(latestVersion) содержит критические исправления безопасности. Обновите приложение для продолжения работы.")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Button(action: openAppStore) {
                    Label("Обновить до \(latestVersion)", systemImage: "arrow.up.right.square")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.horizontal, 32)
            }
        }
    }

    // MARK: - Inline dismissible banner

    private var inlineBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.circle")
                .font(.title2)
                .foregroundStyle(.blue)

            VStack(alignment: .leading, spacing: 2) {
                Text("Доступна версия \(latestVersion)")
                    .font(.subheadline.bold())
                Text("Нажмите «Обновить» для перехода в App Store")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button("Обновить", action: openAppStore)
                .font(.subheadline.bold())
                .foregroundStyle(.blue)

            if let dismiss = onDismiss {
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(uiColor: .systemBackground))
                .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
        )
        .padding(.horizontal, 16)
    }

    // MARK: - Open App Store

    private func openAppStore() {
        // Пробуем deep-link itms-apps:// (открывает App Store напрямую)
        let deepLinkUrl = appStoreUrl.replacingOccurrences(
            of: "https://apps.apple.com",
            with: "itms-apps://itunes.apple.com"
        )

        #if canImport(UIKit)
        if let url = URL(string: deepLinkUrl),
           UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        } else if let url = URL(string: appStoreUrl) {
            // Fallback: открываем через браузер (работает в симуляторе)
            UIApplication.shared.open(url)
        }
        #endif
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Inline banner") {
    VStack {
        UpdateBannerView(
            latestVersion: "1.2.0",
            appStoreUrl: "https://apps.apple.com/app/id000000000",
            isForced: false,
            onDismiss: {}
        )
        Spacer()
    }
    .padding(.top, 16)
    .background(Color(.systemGroupedBackground))
}

#Preview("Forced overlay") {
    UpdateBannerView(
        latestVersion: "1.3.0",
        appStoreUrl: "https://apps.apple.com/app/id000000000",
        isForced: true
    )
}
#endif
