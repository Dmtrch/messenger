// DtoDecodingTests.swift — smoke-тесты декодинга DTO.
// Минимальные дубликаты DTO из Sources/Messenger/service/ApiClient.swift,
// переопределены здесь чтобы не зависеть от app-target (недоступен через SPM).
// Запуск: swift test (из apps/mobile/ios/)

import XCTest

// MARK: - DTO duplicates (mirrors of ApiClient.swift)

private struct LoginResponse: Decodable {
    let accessToken: String
    let userId: String
    let username: String
    let displayName: String?
    let role: String?
}

private struct ChatSummaryDto: Decodable {
    let id: String
    let name: String
    let isGroup: Bool
    let updatedAt: Int64
    let members: [String]
    enum CodingKeys: String, CodingKey {
        case id, name, members
        case isGroup   = "isGroup"
        case updatedAt = "updatedAt"
    }
}

private struct DownloadArtifactDto: Decodable {
    let platform: String
    let arch: String
    let format: String
    let filename: String
    let url: String
    let sha256: String
    let sizeBytes: Int64
    enum CodingKeys: String, CodingKey {
        case platform, arch, format, filename, url, sha256
        case sizeBytes = "size_bytes"
    }
}

private struct DownloadsManifestDto: Decodable {
    let version: String
    let minClientVersion: String
    let changelog: String?
    let artifacts: [DownloadArtifactDto]
}

private struct AdminUserDto: Decodable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let role: String
    let status: String
    enum CodingKeys: String, CodingKey {
        case id, username, role, status
        case displayName = "display_name"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id          = try c.decode(String.self, forKey: .id)
        username    = try c.decode(String.self, forKey: .username)
        displayName = (try? c.decode(String.self, forKey: .displayName)) ?? ""
        role        = (try? c.decode(String.self, forKey: .role)) ?? "user"
        status      = (try? c.decode(String.self, forKey: .status)) ?? "active"
    }
}

private struct AdminSystemStatsDto: Decodable {
    let cpuPercent: Double
    let ramUsed: Int64
    let ramTotal: Int64
    let diskUsed: Int64
    let diskTotal: Int64
}

// MARK: - Tests

final class DtoDecodingTests: XCTestCase {

    private let decoder = JSONDecoder()

    // MARK: LoginResponse

    func test_loginResponse_decodesFromJSON() throws {
        let json = """
        {
            "accessToken": "tok123",
            "userId": "u-1",
            "username": "alice",
            "displayName": "Alice",
            "role": "user"
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(LoginResponse.self, from: json)

        XCTAssertEqual(dto.accessToken, "tok123")
        XCTAssertEqual(dto.userId, "u-1")
        XCTAssertEqual(dto.username, "alice")
        XCTAssertEqual(dto.displayName, "Alice")
        XCTAssertEqual(dto.role, "user")
    }

    func test_loginResponse_optionalFieldsMissing() throws {
        let json = """
        {
            "accessToken": "tok",
            "userId": "u-2",
            "username": "bob"
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(LoginResponse.self, from: json)

        XCTAssertNil(dto.displayName)
        XCTAssertNil(dto.role)
    }

    // MARK: ChatSummaryDto

    func test_chatSummaryDto_decodesFromJSON() throws {
        let json = """
        {
            "id": "chat-42",
            "name": "General",
            "isGroup": true,
            "updatedAt": 1700000000,
            "members": ["u-1", "u-2", "u-3"]
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(ChatSummaryDto.self, from: json)

        XCTAssertEqual(dto.id, "chat-42")
        XCTAssertEqual(dto.name, "General")
        XCTAssertTrue(dto.isGroup)
        XCTAssertEqual(dto.updatedAt, 1_700_000_000)
        XCTAssertEqual(dto.members, ["u-1", "u-2", "u-3"])
    }

    func test_chatSummaryDto_directChat() throws {
        let json = """
        {
            "id": "chat-1",
            "name": "Direct",
            "isGroup": false,
            "updatedAt": 0,
            "members": ["u-A", "u-B"]
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(ChatSummaryDto.self, from: json)

        XCTAssertFalse(dto.isGroup)
        XCTAssertEqual(dto.members.count, 2)
    }

    // MARK: DownloadArtifactDto

    func test_downloadArtifactDto_decodesFromJSON() throws {
        let json = """
        {
            "platform": "macos",
            "arch": "arm64",
            "format": "dmg",
            "filename": "messenger-1.0.dmg",
            "url": "https://example.com/messenger-1.0.dmg",
            "sha256": "abc123def456",
            "size_bytes": 52428800
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(DownloadArtifactDto.self, from: json)

        XCTAssertEqual(dto.platform, "macos")
        XCTAssertEqual(dto.arch, "arm64")
        XCTAssertEqual(dto.format, "dmg")
        XCTAssertEqual(dto.filename, "messenger-1.0.dmg")
        XCTAssertEqual(dto.url, "https://example.com/messenger-1.0.dmg")
        XCTAssertEqual(dto.sha256, "abc123def456")
        XCTAssertEqual(dto.sizeBytes, 52_428_800)
    }

    func test_downloadsManifestDto_decodesWithArtifacts() throws {
        let json = """
        {
            "version": "1.2.3",
            "minClientVersion": "1.0.0",
            "changelog": "Bug fixes",
            "artifacts": [
                {
                    "platform": "linux",
                    "arch": "amd64",
                    "format": "tar.gz",
                    "filename": "messenger-linux.tar.gz",
                    "url": "https://example.com/messenger-linux.tar.gz",
                    "sha256": "deadbeef",
                    "size_bytes": 10485760
                }
            ]
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(DownloadsManifestDto.self, from: json)

        XCTAssertEqual(dto.version, "1.2.3")
        XCTAssertEqual(dto.minClientVersion, "1.0.0")
        XCTAssertEqual(dto.changelog, "Bug fixes")
        XCTAssertEqual(dto.artifacts.count, 1)
        XCTAssertEqual(dto.artifacts[0].sizeBytes, 10_485_760)
    }

    func test_downloadsManifestDto_nilChangelog() throws {
        let json = """
        {
            "version": "2.0.0",
            "minClientVersion": "1.5.0",
            "artifacts": []
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(DownloadsManifestDto.self, from: json)

        XCTAssertNil(dto.changelog)
        XCTAssertTrue(dto.artifacts.isEmpty)
    }

    // MARK: AdminUserDto

    func test_adminUserDto_decodesFromJSON() throws {
        let json = """
        {
            "id": "u-99",
            "username": "charlie",
            "display_name": "Charlie Brown",
            "role": "admin",
            "status": "active"
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(AdminUserDto.self, from: json)

        XCTAssertEqual(dto.id, "u-99")
        XCTAssertEqual(dto.username, "charlie")
        XCTAssertEqual(dto.displayName, "Charlie Brown")
        XCTAssertEqual(dto.role, "admin")
        XCTAssertEqual(dto.status, "active")
    }

    func test_adminUserDto_defaultsWhenFieldsMissing() throws {
        // display_name, role, status — необязательные с дефолтами в custom init
        let json = """
        {
            "id": "u-100",
            "username": "dave"
        }
        """.data(using: .utf8)!

        let dto = try decoder.decode(AdminUserDto.self, from: json)

        XCTAssertEqual(dto.displayName, "")
        XCTAssertEqual(dto.role, "user")
        XCTAssertEqual(dto.status, "active")
    }

    // MARK: AdminSystemStatsDto (snake_case → camelCase via convertFromSnakeCase)

    func test_adminSystemStatsDto_decodesViaSnakeCaseDecoder() throws {
        let snakeDecoder = JSONDecoder()
        snakeDecoder.keyDecodingStrategy = .convertFromSnakeCase

        let json = """
        {
            "cpu_percent": 42.5,
            "ram_used": 1073741824,
            "ram_total": 8589934592,
            "disk_used": 214748364800,
            "disk_total": 500000000000
        }
        """.data(using: .utf8)!

        let dto = try snakeDecoder.decode(AdminSystemStatsDto.self, from: json)

        XCTAssertEqual(dto.cpuPercent, 42.5, accuracy: 0.001)
        XCTAssertEqual(dto.ramUsed, 1_073_741_824)
        XCTAssertEqual(dto.ramTotal, 8_589_934_592)
        XCTAssertEqual(dto.diskTotal, 500_000_000_000)
    }

    // MARK: Malformed JSON

    func test_malformedJSON_throwsDecodingError() {
        let badJSON = "{ not valid json }".data(using: .utf8)!

        XCTAssertThrowsError(try decoder.decode(LoginResponse.self, from: badJSON)) { error in
            XCTAssertTrue(error is DecodingError || error is Swift.DecodingError,
                          "Expected DecodingError, got \(error)")
        }
    }

    func test_missingRequiredField_throwsDecodingError() {
        // LoginResponse requires accessToken — отсутствует
        let json = """
        {
            "userId": "u-1",
            "username": "alice"
        }
        """.data(using: .utf8)!

        XCTAssertThrowsError(try decoder.decode(LoginResponse.self, from: json))
    }
}
