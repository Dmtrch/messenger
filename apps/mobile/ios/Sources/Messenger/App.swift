// App.swift — SwiftUI entry point.
// В Xcode-проекте: создайте App target, добавьте этот файл и пометьте @main.
// Пример:
//   @main struct MessengerApp: App { ... }
//
// Этот файл оставлен без @main, чтобы компилировался в библиотечный target Package.swift.

import SwiftUI
import UserNotifications

// MARK: - AppDelegate (APNs)

#if canImport(UIKit)
import UIKit

/// AppDelegate — нужен для получения APNs device token.
/// В Xcode: добавьте @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate в MessengerApp.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var appViewModel: AppViewModel?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                DispatchQueue.main.async { application.registerForRemoteNotifications() }
            }
        }
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02x", $0) }.joined()
        appViewModel?.onAPNsTokenReceived(tokenString)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // В симуляторе или без APNs-сертификата — ожидаемо, игнорируем
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 willPresent notification: UNNotification,
                                 withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
#endif

struct MessengerApp: App {
    @StateObject private var vm = AppViewModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(vm)
        }
    }
}

// MARK: - Navigation route

enum AppRoute: Hashable {
    case chat(id: String, name: String)
}

// MARK: - Root view

struct RootView: View {
    @EnvironmentObject var vm: AppViewModel
    @State private var navPath = NavigationPath()

    var body: some View {
        ZStack(alignment: .top) {
            NavigationStack(path: $navPath) {
                Group {
                    if !vm.isServerConfigured {
                        ServerSetupScreen()
                    } else if !vm.authState.isAuthenticated {
                        AuthScreen()
                    } else {
                        ChatListScreen { chat in
                            navPath.append(AppRoute.chat(id: chat.id, name: chat.name))
                        }
                    }
                }
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .chat(let id, let name):
                        ChatWindowScreen(chatId: id, chatName: name)
                    }
                }
            }

            // CallOverlay — поверх всего навигационного стека
            if vm.chatStore.callState.status != .idle {
                CallOverlay(
                    callState: vm.chatStore.callState,
                    onAccept:  { vm.acceptCall() },
                    onReject:  { vm.rejectCall() },
                    onHangUp:  { vm.hangUp() }
                )
                .transition(.move(edge: .bottom))
                .animation(.spring(), value: vm.chatStore.callState.status)
            }
        }
    }
}

// MARK: - Call overlay

struct CallOverlay: View {
    let callState: CallState
    let onAccept: () -> Void
    let onReject: () -> Void
    let onHangUp: () -> Void

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 24) {
                // Статус звонка
                Text(statusText)
                    .font(.headline)
                    .foregroundStyle(.white)

                Text(callState.remoteUserId)
                    .font(.title2.bold())
                    .foregroundStyle(.white)

                if callState.isVideo {
                    Image(systemName: "video.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.white.opacity(0.8))
                }

                // Кнопки управления
                HStack(spacing: 40) {
                    if callState.status == .ringingIn {
                        // Входящий: принять + отклонить
                        CallButton(icon: "phone.fill", color: .green, label: "Принять",
                                   action: onAccept)
                        CallButton(icon: "phone.down.fill", color: .red, label: "Отклонить",
                                   action: onReject)
                    } else {
                        // Исходящий / активный: завершить
                        CallButton(icon: "phone.down.fill", color: .red, label: "Завершить",
                                   action: onHangUp)
                    }
                }
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color.black.opacity(0.85))
            )
            .padding()
        }
    }

    private var statusText: String {
        switch callState.status {
        case .ringingIn:  return "Входящий звонок"
        case .ringingOut: return "Вызов…"
        case .active:     return "Активный звонок"
        case .idle:       return ""
        }
    }
}

private struct CallButton: View {
    let icon:   String
    let color:  Color
    let label:  String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Button(action: action) {
                Image(systemName: icon)
                    .font(.title)
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(color)
                    .clipShape(Circle())
            }
            Text(label)
                .font(.caption)
                .foregroundStyle(.white)
        }
    }
}
