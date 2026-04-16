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

struct MediaUploadResponse: Decodable { let mediaId: String }
struct MediaUploadResult { let mediaId: String; let mediaKey: String }

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

    // MARK: - Native push token

    func registerNativePushToken(platform: String, token: String, deviceId: String) async throws {
        struct Body: Encodable { let platform, token, deviceId: String }
        _ = try await post("/api/push/native/register",
                           body: Body(platform: platform, token: token, deviceId: deviceId),
                           authenticated: true) as EmptyBody?
    }

    // MARK: - Key registration

    func registerKeys(_ req: RegisterKeysRequest) async throws {
        _ = try await post("/api/keys/register", body: req, authenticated: true) as EmptyBody?
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
