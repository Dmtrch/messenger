// AppViewModel.swift — главный ViewModel: связывает ApiClient, WSOrchestrator,
// ChatStore, DatabaseManager, KeyStorage.
// Зеркало AppViewModel.kt (Android/Desktop).

import SwiftUI
import Combine
import Sodium

@MainActor
final class AppViewModel: ObservableObject {

    // MARK: - Published state

    @Published private(set) var authState  = AuthState()
    @Published private(set) var isServerConfigured = false
    @Published              var uploadError: String? = nil

    // MARK: - Sub-components (ленивая инициализация после configureServer)

    private(set) var chatStore  = ChatStore()
    private      var db: DatabaseManager?
    private      var apiClient: ApiClient?
    private      var sessionManager: SessionManager?
    private      var wsOrchestrator: WSOrchestrator?
    private      var wsTask: URLSessionWebSocketTask?
    private      var reconnectDelay: Double = 1.0
    private      var isReconnecting = false

    private let tokenStore  = TokenStore()
    private let keyStorage  = KeyStorage()
    private let sodium      = Sodium()

    // MARK: - Server setup

    func configureServer(url: String) {
        let cleaned = url.hasSuffix("/") ? String(url.dropLast()) : url
        UserDefaults.standard.set(cleaned, forKey: "messenger.server.url")
        setupComponents(baseURL: cleaned)
        isServerConfigured = true

        // Автологин если есть сохранённые токены
        if !tokenStore.accessToken.isEmpty {
            Task { await restoreSession() }
        }
    }

    private func setupComponents(baseURL: String) {
        if db == nil {
            let database = try? DatabaseManager()
            db = database
            if let database {
                sessionManager = SessionManager(db: database, keyStorage: keyStorage)
            }
        }
        let client = ApiClient(baseURL: baseURL, tokenStore: tokenStore, sodium: sodium)
        apiClient = client
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws {
        guard let client = apiClient else { return }
        let resp = try await client.login(username: username, password: password)
        authState = AuthState(isAuthenticated: true, userId: "",
                              username: username, accessToken: resp.accessToken)
        await setupWS()
        await registerKeysIfNeeded()
        try await loadChats()
    }

    func logout() async {
        disconnectWS()
        try? await apiClient?.logout()
        authState = AuthState()
        chatStore = ChatStore()
    }

    private func restoreSession() async {
        // Попытка загрузить чаты с текущим токеном; при 401 — предложить логин
        do {
            await setupWS()
            try await loadChats()
            authState = AuthState(isAuthenticated: true, userId: "",
                                  username: UserDefaults.standard.string(forKey: "messenger.username") ?? "",
                                  accessToken: tokenStore.accessToken)
        } catch {
            authState = AuthState()
        }
    }

    // MARK: - Chat loading

    func loadChats() async throws {
        guard let client = apiClient, let db = db else { return }

        let dtos = try await client.getChats()
        let items = dtos.map { dto -> ChatItem in
            let rec = ChatRecord(id: dto.id, name: dto.name, isGroup: dto.isGroup,
                                 updatedAt: dto.updatedAt,
                                 members: (try? String(data: JSONEncoder().encode(dto.members), encoding: .utf8)) ?? "[]")
            try? db.upsertChat(rec)
            return ChatItem(id: dto.id, name: dto.name, isGroup: dto.isGroup,
                            lastMessage: nil, updatedAt: dto.updatedAt, members: dto.members)
        }
        chatStore.setChats(items)
    }

    // MARK: - Send message (full E2E)

    func sendMessage(chatId: String, plaintext: String) async {
        guard let client = apiClient, let db = db, let sm = sessionManager else { return }
        let clientMsgId = UUID().uuidString
        let timestamp   = Int64(Date().timeIntervalSince1970 * 1000)

        // Оптимистичный persist
        let msg = MessageRecord(
            id: clientMsgId, clientMsgId: clientMsgId, chatId: chatId,
            senderId: authState.userId, plaintext: plaintext,
            timestamp: timestamp, status: "sending", isDeleted: false
        )
        try? db.insertMessage(msg)
        chatStore.addMessage(chatId: chatId, item: MessageItem(
            id: clientMsgId, clientMsgId: clientMsgId, chatId: chatId,
            senderId: authState.userId, plaintext: plaintext, timestamp: timestamp,
            status: "sending", isDeleted: false
        ))

        // Шифрование
        let isGroup = chatStore.isGroup(chatId)
        do {
            var recipients: [RecipientDto] = []

            if isGroup {
                // Группа: SenderKey
                let ciphertext = try sm.encryptGroupMessage(chatId: chatId, plaintext: plaintext)
                // fan-out: все участники, кроме себя
                let members = chatStore.chats.first(where: { $0.id == chatId })?.members ?? []
                // SKDM рассылка тем участникам, у которых нет нашего ключа (lazy — при первой отправке)
                for memberId in members where memberId != authState.userId {
                    if let bundle = try? await client.getKeyBundle(userId: memberId),
                       let device = bundle.devices.first {
                        let skdmJson   = try sm.buildSKDM(chatId: chatId)
                        let skdmCipher = try sm.encryptForDevice(
                            peerId: memberId, deviceId: device.deviceId,
                            bundle: device, plaintext: skdmJson)
                        recipients.append(RecipientDto(userId: memberId, deviceId: device.deviceId,
                                                       ciphertext: ciphertext))
                        // SKDM отправляем отдельным сообщением перед основным
                        let skdmReq = SendMessageRequest(
                            chatId: chatId, clientMsgId: UUID().uuidString, senderKeyId: 0,
                            recipients: [RecipientDto(userId: memberId, deviceId: device.deviceId,
                                                      ciphertext: skdmCipher)]
                        )
                        try? await client.sendMessage(skdmReq)
                    }
                }
            } else {
                // Direct: X3DH + Double Ratchet, fan-out по устройствам
                let members = chatStore.chats.first(where: { $0.id == chatId })?.members ?? []
                for peerId in members where peerId != authState.userId {
                    let bundle = try await client.getKeyBundle(userId: peerId)
                    for device in bundle.devices {
                        let ciphertext = try sm.encryptForDevice(
                            peerId: peerId, deviceId: device.deviceId,
                            bundle: device, plaintext: plaintext)
                        recipients.append(RecipientDto(userId: peerId, deviceId: device.deviceId,
                                                       ciphertext: ciphertext))
                    }
                }
            }

            let req = SendMessageRequest(chatId: chatId, clientMsgId: clientMsgId,
                                          senderKeyId: 0, recipients: recipients)
            try await client.sendMessage(req)
            try? db.updateMessageStatus(clientMsgId: clientMsgId, status: "sent")
            chatStore.onMessageStatusUpdate(clientMsgId: clientMsgId, status: "sent")
        } catch {
            // Outbox fallback при ошибке
            try? db.addOutboxItem(clientMsgId: clientMsgId, chatId: chatId,
                                  payload: plaintext)
        }
    }

    // MARK: - Media

    func uploadMedia(data: Data, filename: String, contentType: String, chatId: String) async {
        guard let client = apiClient else { return }
        let msgId = UUID().uuidString
        do {
            let result = try await client.uploadEncryptedMedia(
                bytes: data, filename: filename,
                contentType: contentType, chatId: chatId, msgId: msgId
            )
            // TODO: прикрепить mediaId/mediaKey к сообщению перед отправкой
            _ = result
        } catch {
            uploadError = error.localizedDescription
        }
    }

    func clearUploadError() { uploadError = nil }

    // MARK: - WebSocket

    private func setupWS() async {
        guard let client = apiClient else { return }
        let token    = tokenStore.accessToken
        let deviceId = keyStorage.getOrCreateDeviceId()
        guard let url = await client.wsURL(token: token, deviceId: deviceId) else { return }

        guard let sm = sessionManager else { return }
        let orch = WSOrchestrator(sessionManager: sm,
                                  chatStore: chatStore, db: db!,
                                  currentUserId: authState.userId)
        orch.sendFrame = { [weak self] frame in self?.sendWSFrame(frame) }
        wsOrchestrator = orch

        let task = URLSession.shared.webSocketTask(with: url)
        wsTask = task
        task.resume()
        receiveLoop(task: task)
    }

    private func receiveLoop(task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                if case .string(let text) = msg {
                    self.wsOrchestrator?.onFrame(text)
                }
                self.receiveLoop(task: task)
                self.reconnectDelay = 1.0
            case .failure:
                self.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() {
        guard !isReconnecting else { return }
        isReconnecting = true
        let delay = reconnectDelay
        reconnectDelay = min(reconnectDelay * 2, 30.0)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, self.authState.isAuthenticated else { return }
            self.isReconnecting = false
            await self.setupWS()
        }
    }

    private func sendWSFrame(_ text: String) {
        wsTask?.send(.string(text)) { _ in }
    }

    private func disconnectWS() {
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
    }

    // MARK: - APNs push token

    /// Вызывается AppDelegate при успешной регистрации для APNs.
    func onAPNsTokenReceived(_ token: String) {
        UserDefaults.standard.set(token, forKey: "messenger.apns.token")
        guard let client = apiClient else { return }
        let deviceId = keyStorage.getOrCreateDeviceId()
        Task {
            try? await client.registerNativePushToken(platform: "apns", token: token, deviceId: deviceId)
        }
    }

    // MARK: - Key registration

    private func registerKeysIfNeeded() async {
        guard let client = apiClient else { return }
        let ik        = keyStorage.getOrCreateIdentityKey()
        let (spk, sig) = keyStorage.getOrCreateSignedPreKey()
        let opks      = keyStorage.generateOneTimePreKeys(count: 10)

        let req = RegisterKeysRequest(
            identityKey:           Data(ik.publicKey).base64EncodedString(),
            signedPreKey:          Data(spk.publicKey).base64EncodedString(),
            signedPreKeySignature: Data(sig).base64EncodedString(),
            oneTimePreKeys:        opks.map { Data($0.publicKey).base64EncodedString() }
        )
        try? await client.registerKeys(req)
    }

    // MARK: - Calls

    func initiateCall(chatId: String, isVideo: Bool) {
        let callId = UUID().uuidString
        let targetId = chatStore.chats.first(where: { $0.id == chatId })?.members
                                      .first(where: { $0 != authState.userId }) ?? ""
        chatStore.setOutgoingCall(callId: callId, chatId: chatId, targetId: targetId, isVideo: isVideo)
        let frame: [String: Any] = [
            "type": "call_offer", "callId": callId, "chatId": chatId,
            "sdp": "stub-sdp", "isVideo": isVideo
        ]
        if let data = try? JSONSerialization.data(withJSONObject: frame),
           let text = String(data: data, encoding: .utf8) { sendWSFrame(text) }
    }

    func acceptCall() {
        let cs = chatStore.callState
        guard cs.status == .ringingIn else { return }
        let frame: [String: Any] = ["type": "call_answer", "callId": cs.callId, "sdp": "stub-sdp"]
        if let data = try? JSONSerialization.data(withJSONObject: frame),
           let text = String(data: data, encoding: .utf8) { sendWSFrame(text) }
        chatStore.onCallAnswer(callId: cs.callId)
    }

    func rejectCall() {
        let cs = chatStore.callState
        let frame: [String: Any] = ["type": "call_reject", "callId": cs.callId]
        if let data = try? JSONSerialization.data(withJSONObject: frame),
           let text = String(data: data, encoding: .utf8) { sendWSFrame(text) }
        chatStore.clearCall()
    }

    func hangUp() {
        let cs = chatStore.callState
        let frame: [String: Any] = ["type": "call_end", "callId": cs.callId]
        if let data = try? JSONSerialization.data(withJSONObject: frame),
           let text = String(data: data, encoding: .utf8) { sendWSFrame(text) }
        chatStore.clearCall()
    }

    // MARK: - Init

    init() {
        if let url = UserDefaults.standard.string(forKey: "messenger.server.url"), !url.isEmpty {
            setupComponents(baseURL: url)
            isServerConfigured = true
        }
    }
}
