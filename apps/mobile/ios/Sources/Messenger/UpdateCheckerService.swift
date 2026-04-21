// UpdateCheckerService.swift
// Сервис проверки обновлений приложения.
// Опрашивает GET /api/version каждые 24 часа и публикует информацию об обновлении.

import Foundation
import Combine

// MARK: - UpdateInfo

/// Информация об обновлении, возвращаемая сервером.
struct UpdateInfo: Codable {
    /// Последняя доступная версия приложения.
    let latestVersion: String
    /// Минимальная поддерживаемая версия (ниже — принудительное обновление).
    let minVersion: String?
    /// URL приложения в App Store.
    let appStoreUrl: String
    /// Текущая версия считается принудительно устаревшей.
    let forced: Bool

    enum CodingKeys: String, CodingKey {
        case latestVersion  = "latest_version"
        case minVersion     = "min_version"
        case appStoreUrl    = "app_store_url"
        case forced
    }
}

// MARK: - UpdateCheckerService

/// Сервис проверки наличия обновлений приложения.
/// - Проверяет `GET /api/version` при запуске и затем каждые 24 часа.
/// - Публикует `updateInfo` только если доступна новая версия.
final class UpdateCheckerService: ObservableObject {

    // MARK: Published state

    /// Информация об обновлении. `nil` — обновлений нет или ещё не проверялось.
    @Published var updateInfo: UpdateInfo? = nil

    /// Флаг принудительного обновления (minVersion > currentVersion).
    @Published var isForced: Bool = false

    // MARK: Private

    private let session: URLSession
    private var checkTask: Task<Void, Never>?

    private static let checkInterval: TimeInterval = 24 * 60 * 60  // 24 часа
    private static let userDefaultsLastCheckKey = "UpdateCheckerService.lastCheckDate"

    // MARK: Init

    init(session: URLSession = .shared) {
        self.session = session
    }

    deinit {
        checkTask?.cancel()
    }

    // MARK: Public API

    /// Запустить периодическую проверку обновлений.
    /// - Parameter serverUrl: Базовый URL сервера мессенджера (например, "https://chat.example.com").
    func start(serverUrl: String) {
        checkTask?.cancel()
        checkTask = Task { [weak self] in
            await self?.runCheckLoop(serverUrl: serverUrl)
        }
    }

    /// Остановить периодическую проверку.
    func stop() {
        checkTask?.cancel()
        checkTask = nil
    }

    /// Принудительно выполнить проверку прямо сейчас.
    func checkNow(serverUrl: String) {
        Task { [weak self] in
            await self?.performCheck(serverUrl: serverUrl)
        }
    }

    // MARK: Private

    private func runCheckLoop(serverUrl: String) async {
        // При первом запуске — проверить немедленно или через оставшееся время
        let lastCheck = UserDefaults.standard.object(forKey: Self.userDefaultsLastCheckKey) as? Date
        let now = Date()

        if let last = lastCheck {
            let elapsed = now.timeIntervalSince(last)
            if elapsed < Self.checkInterval {
                let remaining = Self.checkInterval - elapsed
                try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            }
        }

        // Первая проверка
        await performCheck(serverUrl: serverUrl)

        // Периодические проверки каждые 24 часа
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(Self.checkInterval * 1_000_000_000))
            guard !Task.isCancelled else { break }
            await performCheck(serverUrl: serverUrl)
        }
    }

    private func performCheck(serverUrl: String) async {
        guard !serverUrl.isEmpty,
              let url = URL(string: serverUrl.trimmingCharacters(in: .init(charactersIn: "/")) + "/api/version")
        else { return }

        do {
            let (data, response) = try await session.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200
            else { return }

            let decoder = JSONDecoder()
            let info = try decoder.decode(UpdateInfo.self, from: data)

            UserDefaults.standard.set(Date(), forKey: Self.userDefaultsLastCheckKey)

            await handleUpdateInfo(info)
        } catch {
            // Сеть недоступна или сервер не поддерживает /api/version — молча игнорируем
        }
    }

    @MainActor
    private func handleUpdateInfo(_ info: UpdateInfo) {
        let current = currentAppVersion()

        // Сравниваем версии: показываем баннер только если latestVersion > current
        guard compareVersions(info.latestVersion, isGreaterThan: current) else {
            updateInfo = nil
            isForced = false
            return
        }

        updateInfo = info

        // Принудительное обновление: либо флаг forced, либо minVersion > current
        if info.forced {
            isForced = true
        } else if let minVersion = info.minVersion,
                  compareVersions(minVersion, isGreaterThan: current) {
            isForced = true
        } else {
            isForced = false
        }
    }

    // MARK: Version comparison

    private func currentAppVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// Возвращает `true`, если `versionA` строго новее `versionB`.
    /// Сравнивает числовые компоненты семантических версий (major.minor.patch).
    private func compareVersions(_ versionA: String, isGreaterThan versionB: String) -> Bool {
        let partsA = versionA.split(separator: ".").compactMap { Int($0) }
        let partsB = versionB.split(separator: ".").compactMap { Int($0) }

        let maxLen = max(partsA.count, partsB.count)
        for i in 0..<maxLen {
            let a = i < partsA.count ? partsA[i] : 0
            let b = i < partsB.count ? partsB[i] : 0
            if a != b { return a > b }
        }
        return false
    }
}
