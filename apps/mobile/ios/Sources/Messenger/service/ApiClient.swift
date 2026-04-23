// ApiClient.swift — REST-клиент на URLSession с автоматическим refresh токена.
// Зеркало ApiClient.kt (Android).

import Foundation
import Sodium

// MARK: - DTO types

struct LoginRequest: Encodable { let username: String; let password: String }
struct LoginResponse: Decodable {
    let accessToken: String
    let userId: String
    let username: String
    let displayName: String?
    let role: String?
}
struct RefreshResponse: Decodable { let accessToken: String }

struct ChatSummaryDto: Decodable {
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

struct IceServerDto: Decodable {
    let urls: String
    let username: String?
    let credential: String?
}
struct IceServersResponse: Decodable { let iceServers: [IceServerDto] }

struct SendMessageRequest: Encodable {
    let chatId: String
    let clientMsgId: String
    let senderKeyId: Int
    let recipients: [RecipientDto]
}
struct RecipientDto: Encodable {
    let userId: String
    let deviceId: String?
    let ciphertext: String
}

struct RegisterKeysRequest: Encodable {
    let deviceName: String
    let ikPublic: String
    let spkId: Int
    let spkPublic: String
    let spkSignature: String
    let opkPublics: [String]
}

struct RegisterKeysResponse: Decodable {
    let deviceId: String
    let opkIds: [Int]
}

struct OpkPublicDto: Encodable { let id: Int; let key: String }
struct DeviceLinkActivateRequest: Encodable {
    let token: String
    let deviceName: String
    let ikPublic: String
    let spkId: Int
    let spkPublic: String
    let spkSignature: String
    let opkPublics: [OpkPublicDto]
}
struct DeviceLinkActivateResponse: Decodable {
    let accessToken: String
    let userId: String
    let username: String
    let displayName: String?
    let role: String?
    let deviceId: String
}

struct DeviceBundle: Decodable {
    let deviceId: String
    let ikPublic: String
    let spkId: Int
    let spkPublic: String
    let spkSignature: String
    let opkId: Int?
    let opkPublic: String?
}
struct PreKeyBundleResponse: Decodable { let devices: [DeviceBundle] }

struct UserResultDto: Decodable { let id: String; let username: String; let displayName: String }
struct SearchUsersResponse: Decodable { let users: [UserResultDto] }
struct CreateChatRequest: Encodable { let type: String; let memberIds: [String]; let name: String? }
struct CreateChatResponse: Decodable { let chat: ChatSummaryDto }

struct MediaUploadResponse: Decodable { let mediaId: String }
struct MediaUploadResult { let mediaId: String; let mediaKey: String }

struct DownloadArtifactDto: Decodable {
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
struct DownloadsManifestDto: Decodable {
    let version: String
    let minClientVersion: String
    let changelog: String?
    let artifacts: [DownloadArtifactDto]
}

struct AdminUserDto: Decodable, Identifiable {
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
        id = try c.decode(String.self, forKey: .id)
        username = try c.decode(String.self, forKey: .username)
        displayName = (try? c.decode(String.self, forKey: .displayName)) ?? ""
        role = (try? c.decode(String.self, forKey: .role)) ?? "user"
        status = (try? c.decode(String.self, forKey: .status)) ?? "active"
    }
}
struct AdminUsersResponse: Decodable { let users: [AdminUserDto] }

struct AdminRegRequestDto: Decodable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let status: String
    enum CodingKeys: String, CodingKey {
        case id, username, status
        case displayName = "display_name"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = try c.decode(String.self, forKey: .username)
        displayName = (try? c.decode(String.self, forKey: .displayName)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? "pending"
    }
}
struct AdminRegRequestsResponse: Decodable { let requests: [AdminRegRequestDto] }

struct AdminResetRequestDto: Decodable, Identifiable {
    let id: String
    let userId: String
    let username: String
    let status: String
    enum CodingKeys: String, CodingKey {
        case id, username, status
        case userId = "user_id"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? "pending"
    }
}
struct AdminResetRequestsResponse: Decodable { let requests: [AdminResetRequestDto] }

struct AdminInviteCodeDto: Decodable, Identifiable {
    let code: String
    let createdBy: String
    let usedBy: String
    let usedAt: Int64
    let expiresAt: Int64
    let revokedAt: Int64
    let createdAt: Int64
    var id: String { code }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        createdBy = (try? c.decode(String.self, forKey: .createdBy)) ?? ""
        usedBy    = (try? c.decode(String.self, forKey: .usedBy)) ?? ""
        usedAt    = (try? c.decode(Int64.self, forKey: .usedAt)) ?? 0
        expiresAt = (try? c.decode(Int64.self, forKey: .expiresAt)) ?? 0
        revokedAt = (try? c.decode(Int64.self, forKey: .revokedAt)) ?? 0
        createdAt = (try? c.decode(Int64.self, forKey: .createdAt)) ?? 0
    }
    enum CodingKeys: String, CodingKey { case code, createdBy, usedBy, usedAt, expiresAt, revokedAt, createdAt }
}
struct AdminInviteCodesResponse: Decodable { let codes: [AdminInviteCodeDto] }
struct AdminRetentionDto: Decodable { let retentionDays: Int }
struct AdminMaxMembersDto: Decodable { let maxMembers: Int }

struct AdminSystemStatsDto: Decodable {
    let cpuPercent: Double
    let ramUsed: Int64
    let ramTotal: Int64
    let diskUsed: Int64
    let diskTotal: Int64
}

// MARK: - Errors

enum ApiError: Error {
    case httpError(Int, String)
    case unauthorized
    case tooLarge
    case decryptionFailed
}

// MARK: - ApiClient

actor ApiClient {
    let baseURL: String
    private let tokenStore: TokenStoreProtocol
    private let sodium: Sodium
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    init(baseURL: String, tokenStore: TokenStoreProtocol, sodium: Sodium = Sodium()) {
        self.baseURL    = baseURL
        self.tokenStore = tokenStore
        self.sodium     = sodium
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        self.session = URLSession(configuration: config)
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws -> LoginResponse {
        let resp: LoginResponse = try await post("/api/auth/login",
                                                  body: LoginRequest(username: username, password: password),
                                                  authenticated: false)
        tokenStore.save(accessToken: resp.accessToken)
        return resp
    }

    func logout() async throws {
        _ = try? await post("/api/auth/logout", body: EmptyBody(), authenticated: true) as EmptyBody?
        tokenStore.clear()
    }

    func activateDeviceLink(_ req: DeviceLinkActivateRequest) async throws -> DeviceLinkActivateResponse {
        let resp: DeviceLinkActivateResponse = try await post("/api/auth/device-link-activate",
                                                              body: req, authenticated: false)
        tokenStore.save(accessToken: resp.accessToken)
        return resp
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let newPassword: String
        }
        _ = try await post("/api/auth/change-password",
                           body: Body(currentPassword: currentPassword, newPassword: newPassword),
                           authenticated: true) as EmptyBody?
    }

    // MARK: - Chats

    func getChats() async throws -> [ChatSummaryDto] {
        try await get("/api/chats")
    }

    // MARK: - ICE servers

    func getIceServers() async throws -> IceServersResponse {
        try await get("/api/calls/ice-servers")
    }

    // MARK: - Key bundle (for E2E session setup)

    func getKeyBundle(userId: String) async throws -> PreKeyBundleResponse {
        try await get("/api/keys/\(userId)")
    }

    func searchUsers(query: String) async throws -> SearchUsersResponse {
        try await get("/api/users/search?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")")
    }

    func createChat(type: String, memberIds: [String], name: String? = nil) async throws -> CreateChatResponse {
        try await post("/api/chats", body: CreateChatRequest(type: type, memberIds: memberIds, name: name), authenticated: true)
    }

    // MARK: - Native push token

    func registerNativePushToken(platform: String, token: String, deviceId: String) async throws {
        struct Body: Encodable { let platform, token, deviceId: String }
        _ = try await post("/api/push/native/register",
                           body: Body(platform: platform, token: token, deviceId: deviceId),
                           authenticated: true) as EmptyBody?
    }

    // MARK: - Key registration

    func registerKeys(_ req: RegisterKeysRequest) async throws -> RegisterKeysResponse {
        try await post("/api/keys/register", body: req, authenticated: true)
    }

    // MARK: - Encrypted media

    private let maxUploadBytes = 10 * 1024 * 1024  // 10 МБ

    func uploadEncryptedMedia(bytes: Data, filename: String,
                               contentType: String, chatId: String, msgId: String) async throws -> MediaUploadResult {
        guard bytes.count <= maxUploadBytes else { throw ApiError.tooLarge }

        let key   = sodium.randomBytes.buf(length: 32)!
        let nonce = sodium.secretBox.nonce()
        guard let cipher = sodium.secretBox.seal(message: Bytes(bytes), secretKey: key, nonce: nonce) else {
            throw ApiError.decryptionFailed
        }
        let combined = Data(nonce + cipher)

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("chat_id", chatId)
        field("msg_id",  msgId)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"encrypted\"\r\nContent-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(combined)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = try buildRequest("/api/media/upload", method: "POST", authenticated: true)
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let (data, response) = try await session.data(for: req)
        try validate(response)
        let resp = try decoder.decode(MediaUploadResponse.self, from: data)
        return MediaUploadResult(mediaId: resp.mediaId,
                                 mediaKey: Data(key).base64EncodedString())
    }

    func fetchDecryptedMedia(mediaId: String, mediaKeyBase64: String) async throws -> Data {
        guard let key = Data(base64Encoded: mediaKeyBase64) else { throw ApiError.decryptionFailed }
        let combined: Data = try await get("/api/media/\(mediaId)")
        guard combined.count > sodium.secretBox.NonceBytes else { throw ApiError.decryptionFailed }
        let nonce  = Bytes(combined.prefix(sodium.secretBox.NonceBytes))
        let cipher = Bytes(combined.dropFirst(sodium.secretBox.NonceBytes))
        guard let plain = sodium.secretBox.open(authenticatedCipherText: cipher,
                                                secretKey: Bytes(key), nonce: nonce) else {
            throw ApiError.decryptionFailed
        }
        return Data(plain)
    }

    // MARK: - Admin API

    func adminListUsers() async throws -> [AdminUserDto] {
        let r: AdminUsersResponse = try await get("/api/admin/users"); return r.users
    }
    func adminListRegistrationRequests() async throws -> [AdminRegRequestDto] {
        let r: AdminRegRequestsResponse = try await get("/api/admin/registration-requests?status=pending"); return r.requests
    }
    func adminListResetRequests() async throws -> [AdminResetRequestDto] {
        let r: AdminResetRequestsResponse = try await get("/api/admin/password-reset-requests?status=pending"); return r.requests
    }

    func adminSuspendUser(_ id: String)    async throws { try await adminPostEmpty("/api/admin/users/\(id)/suspend") }
    func adminUnsuspendUser(_ id: String)  async throws { try await adminPostEmpty("/api/admin/users/\(id)/unsuspend") }
    func adminBanUser(_ id: String)        async throws { try await adminPostEmpty("/api/admin/users/\(id)/ban") }
    func adminRevokeSessions(_ id: String) async throws { try await adminPostEmpty("/api/admin/users/\(id)/revoke-sessions") }
    func adminRemoteWipe(_ id: String)     async throws { try await adminPostEmpty("/api/admin/users/\(id)/remote-wipe") }

    func adminApproveRegistration(_ id: String) async throws { try await adminPostEmpty("/api/admin/registration-requests/\(id)/approve") }
    func adminRejectRegistration(_ id: String)  async throws { try await adminPostEmpty("/api/admin/registration-requests/\(id)/reject") }

    func adminSetUserRole(_ id: String, role: String) async throws {
        struct Body: Encodable { let role: String }
        try await adminPutJSON("/api/admin/users/\(id)/role", body: Body(role: role))
    }
    func adminResetUserPassword(_ id: String, newPassword: String) async throws {
        struct Body: Encodable { let newPassword: String }
        _ = try await post("/api/admin/users/\(id)/reset-password", body: Body(newPassword: newPassword), authenticated: true) as EmptyBody?
    }
    func adminResolveReset(_ id: String, tempPassword: String) async throws {
        struct Body: Encodable { let tempPassword: String }
        _ = try await post("/api/admin/password-reset-requests/\(id)/resolve", body: Body(tempPassword: tempPassword), authenticated: true) as EmptyBody?
    }

    private func adminPostEmpty(_ path: String) async throws {
        struct Empty: Encodable {}
        _ = try await post(path, body: Empty(), authenticated: true) as EmptyBody?
    }

    private func adminPutJSON<B: Encodable>(_ path: String, body: B) async throws {
        var req = try buildRequest(path, method: "PUT", authenticated: true)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        let (_, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (_, resp2) = try await session.data(for: req)
            try validate(resp2); return
        }
        try validate(response)
    }

    // MARK: - Admin extras (invites, settings, system)

    func adminListInviteCodes() async throws -> [AdminInviteCodeDto] {
        let r: AdminInviteCodesResponse = try await get("/api/admin/invite-codes"); return r.codes
    }
    func adminCreateInviteCode() async throws -> AdminInviteCodeDto {
        struct Empty: Encodable {}
        return try await post("/api/admin/invite-codes", body: Empty(), authenticated: true)
    }
    func adminRevokeInviteCode(_ code: String) async throws {
        guard let encoded = code.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw ApiError.httpError(400, "bad code")
        }
        var req = try buildRequest("/api/admin/invite-codes/\(encoded)", method: "DELETE", authenticated: true)
        let (_, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (_, resp2) = try await session.data(for: req)
            try validate(resp2); return
        }
        try validate(response)
    }

    func adminGetRetention() async throws -> Int {
        let r: AdminRetentionDto = try await get("/api/admin/settings/retention"); return r.retentionDays
    }
    func adminSetRetention(_ days: Int) async throws {
        struct Body: Encodable { let retentionDays: Int }
        try await adminPutJSON("/api/admin/settings/retention", body: Body(retentionDays: days))
    }
    func adminGetMaxGroupMembers() async throws -> Int {
        let r: AdminMaxMembersDto = try await get("/api/admin/settings/max-group-members"); return r.maxMembers
    }
    func adminSetMaxGroupMembers(_ value: Int) async throws {
        struct Body: Encodable { let maxMembers: Int }
        try await adminPutJSON("/api/admin/settings/max-group-members", body: Body(maxMembers: value))
    }

    func adminGetSystemStats() async throws -> AdminSystemStatsDto {
        try await get("/api/admin/system/stats")
    }

    // MARK: - Downloads manifest / artifacts

    func getDownloadsManifest() async throws -> DownloadsManifestDto {
        var req = try buildRequest("/api/downloads/manifest", method: "GET", authenticated: true)
        let (data, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (data2, resp2) = try await session.data(for: req)
            try validate(resp2)
            return try JSONDecoder().decode(DownloadsManifestDto.self, from: data2)
        }
        try validate(response)
        return try JSONDecoder().decode(DownloadsManifestDto.self, from: data)
    }

    func downloadArtifact(filename: String) async throws -> Data {
        var req = try buildRequest("/api/downloads/\(filename)", method: "GET", authenticated: true)
        let (data, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (data2, resp2) = try await session.data(for: req)
            try validate(resp2)
            return data2
        }
        try validate(response)
        return data
    }

    // MARK: - WS URL helper

    nonisolated func wsURL(token: String, deviceId: String) -> URL? {
        let ws = baseURL.replacingOccurrences(of: "https://", with: "wss://")
                        .replacingOccurrences(of: "http://",  with: "ws://")
        return URL(string: "\(ws)/ws?token=\(token)&deviceId=\(deviceId)")
    }

    // MARK: - Generic request helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var req = try buildRequest(path, method: "GET", authenticated: true)
        let (data, response) = try await session.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (data2, resp2) = try await session.data(for: req)
            try validate(resp2)
            return try decoder.decode(T.self, from: data2)
        }
        try validate(response)
        return try decoder.decode(T.self, from: data)
    }

    @discardableResult
    private func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body,
                                                            authenticated: Bool) async throws -> Response {
        var req = try buildRequest(path, method: "POST", authenticated: authenticated)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: req)
        if authenticated && (response as? HTTPURLResponse)?.statusCode == 401 {
            try await refreshAccessToken()
            req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization")
            let (data2, resp2) = try await session.data(for: req)
            try validate(resp2)
            if data2.isEmpty { return EmptyBody() as! Response }
            return try decoder.decode(Response.self, from: data2)
        }
        try validate(response)
        if data.isEmpty { return EmptyBody() as! Response }
        return try decoder.decode(Response.self, from: data)
    }

    private func buildRequest(_ path: String, method: String, authenticated: Bool) throws -> URLRequest {
        guard let url = URL(string: baseURL + path) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = method
        if authenticated { req.setValue("Bearer \(tokenStore.accessToken)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func refreshAccessToken() async throws {
        let req = try buildRequest("/api/auth/refresh", method: "POST", authenticated: false)
        let (data, response) = try await session.data(for: req)
        try validate(response)
        let resp = try decoder.decode(RefreshResponse.self, from: data)
        tokenStore.save(accessToken: resp.accessToken)
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard http.statusCode < 400 else {
            if http.statusCode == 401 { throw ApiError.unauthorized }
            throw ApiError.httpError(http.statusCode, HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
        }
    }
}

// Пустой тип для POST-ответов без тела
private struct EmptyBody: Codable {}
