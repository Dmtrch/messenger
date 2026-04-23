// AppViewModel.swift — главный ViewModel: связывает ApiClient, WSOrchestrator,
// ChatStore, DatabaseManager, KeyStorage.
// Зеркало AppViewModel.kt (Android/Desktop).

import SwiftUI
import Combine
import Sodium

#if canImport(WebRTC)
import WebRTC
#endif

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

    // MARK: - WebRTC

#if canImport(WebRTC)
    private var webRtcController: iOSWebRtcController?
    /// Постоянные MTL-views; пересоздаются при каждом новом звонке.
    private(set) var localVideoView  = RTCMTLVideoView()
    private(set) var remoteVideoView = RTCMTLVideoView()
#endif
    /// SDP входящего offer — хранится вне CallState, чтобы не мешать UI-состоянию.
    private var pendingIncomingOfferSdp: String?

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
        UserDefaults.standard.set(resp.userId,   forKey: "messenger.userId")
        UserDefaults.standard.set(resp.username, forKey: "messenger.username")
        authState = AuthState(isAuthenticated: true, userId: resp.userId,
                              username: resp.username, accessToken: resp.accessToken)
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

    /// Активирует токен привязки: стирает предыдущие локальные ключи, генерирует свежие X3DH-ключи
    /// и отправляет их вместе с `token`/`deviceName` на `/api/auth/device-link-activate`.
    /// После успеха открывает сессию аналогично обычному login.
    func activateDeviceLink(token: String, deviceName: String) async throws {
        guard let client = apiClient else { throw ApiError.unauthorized }

        // Фреш-генерация ключей для нового устройства (стираем любые остаточные).
        keyStorage.clearAll()
        let ik       = keyStorage.getOrCreateIdentityKey()
        let (spk, sig) = keyStorage.getOrCreateSignedPreKey()
        let spkId    = keyStorage.getOrCreateSpkId()
        let opks     = keyStorage.generateOneTimePreKeys(count: 10)

        let req = DeviceLinkActivateRequest(
            token: token,
            deviceName: deviceName,
            ikPublic: Data(ik.publicKey).base64EncodedString(),
            spkId: spkId,
            spkPublic: Data(spk.publicKey).base64EncodedString(),
            spkSignature: Data(sig).base64EncodedString(),
            opkPublics: opks.enumerated().map { (idx, kp) in
                OpkPublicDto(id: idx + 1, key: Data(kp.publicKey).base64EncodedString())
            }
        )
        let resp = try await client.activateDeviceLink(req)

        // Сохраняем OPK-секреты под локальными ID (сервер не возвращает opkIds для device-link).
        opks.enumerated().forEach { (idx, kp) in
            keyStorage.saveOneTimePreKeySecret(kp.secretKey, id: idx + 1)
        }

        UserDefaults.standard.set(resp.userId,   forKey: "messenger.userId")
        UserDefaults.standard.set(resp.username, forKey: "messenger.username")
        authState = AuthState(isAuthenticated: true, userId: resp.userId,
                              username: resp.username, accessToken: resp.accessToken)
        await setupWS()
        try await loadChats()
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        guard let client = apiClient else { throw ApiError.unauthorized }
        try await client.changePassword(currentPassword: currentPassword,
                                        newPassword: newPassword)
    }

    private func restoreSession() async {
        // Попытка загрузить чаты с текущим токеном; при 401 — предложить логин
        do {
            await setupWS()
            try await loadChats()
            authState = AuthState(isAuthenticated: true,
                                  userId:   UserDefaults.standard.string(forKey: "messenger.userId")   ?? "",
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
                        // SKDM отправляем по WS перед основным сообщением
                        let skdmReq = SendMessageRequest(
                            chatId: chatId, clientMsgId: UUID().uuidString, senderKeyId: 0,
                            recipients: [RecipientDto(userId: memberId, deviceId: device.deviceId,
                                                      ciphertext: skdmCipher)]
                        )
                        sendMessageViaWS(skdmReq)
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
            
            if wsTask?.state == .running {
                sendMessageViaWS(req)
                try? db.updateMessageStatus(clientMsgId: clientMsgId, status: "sent")
                chatStore.onMessageStatusUpdate(clientMsgId: clientMsgId, status: "sent")
            } else {
                // WS offline: сохраняем готовый зашифрованный JSON в Outbox
                if let frame = serializeMessageFrame(req) {
                    try? db.addOutboxItem(clientMsgId: clientMsgId, chatId: chatId, payload: frame)
                }
            }
        } catch {
            print("SendMessage encrypt error: \(error)")
        }
    }

    private func processOutbox() async {
        guard let db = db, authState.isAuthenticated else { return }
        do {
            let items = try db.loadOutbox()
            for item in items {
                sendWSFrame(item.payload)
                try? db.deleteOutboxItem(clientMsgId: item.clientMsgId)
                try? db.updateMessageStatus(clientMsgId: item.clientMsgId, status: "sent")
                await MainActor.run {
                    self.chatStore.onMessageStatusUpdate(clientMsgId: item.clientMsgId, status: "sent")
                }
            }
        } catch {
            print("Outbox error: \(error)")
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
            let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
            let record = MessageRecord(
                id: msgId, clientMsgId: msgId, chatId: chatId,
                senderId: authState.userId, plaintext: "",
                timestamp: timestamp, status: "sent", isDeleted: false,
                mediaId: result.mediaId, mediaKey: result.mediaKey,
                originalName: filename, contentType: contentType
            )
            try? db?.insertMessage(record)
            await MainActor.run {
                self.chatStore.addMessage(chatId: chatId, item: MessageItem(
                    id: msgId, clientMsgId: msgId, chatId: chatId,
                    senderId: self.authState.userId, plaintext: "",
                    timestamp: timestamp, status: "sent", isDeleted: false,
                    mediaId: result.mediaId, mediaKey: result.mediaKey,
                    originalName: filename, contentType: contentType
                ))
            }
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

        // MARK: WebRTC callbacks
#if canImport(WebRTC)
        orch.onCallOffer = { [weak self] _, _, _, _, sdp in
            // callId/chatId/fromUserId/isVideo уже обработаны → ChatStore.onCallOffer()
            // сохраняем SDP отдельно для acceptCall()
            self?.pendingIncomingOfferSdp = sdp
        }
        orch.onCallAnswer = { [weak self] _, sdp in
            self?.webRtcController?.setRemoteAnswer(sdp: sdp)
        }
        orch.onIceCandidate = { [weak self] _, candidate, sdpMid, sdpMLineIndex in
            self?.webRtcController?.addRemoteIceCandidate(
                candidate: candidate, sdpMid: sdpMid, sdpMLineIndex: Int32(sdpMLineIndex))
        }
#endif

        wsOrchestrator = orch

        let task = URLSession.shared.webSocketTask(with: url)
        wsTask = task
        task.resume()
        receiveLoop(task: task)
        
        // Авто-отправка очереди при подключении
        Task { await processOutbox() }
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

    /// Сериализует SendMessageRequest в WS-фрейм `{ type, chatId, clientMsgId, senderKeyId, recipients }`.
    private func sendMessageViaWS(_ req: SendMessageRequest) {
        if let text = serializeMessageFrame(req) {
            sendWSFrame(text)
        }
    }

    private func serializeMessageFrame(_ req: SendMessageRequest) -> String? {
        struct WsFrame: Encodable {
            let type = "message"
            let chatId: String
            let clientMsgId: String
            let senderKeyId: Int
            let recipients: [RecipientDto]
        }
        let frame = WsFrame(chatId: req.chatId, clientMsgId: req.clientMsgId,
                            senderKeyId: req.senderKeyId, recipients: req.recipients)
        guard let data = try? JSONEncoder().encode(frame),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }

    private func sendWSFrame(_ text: String) {
        wsTask?.send(.string(text)) { _ in }
    }

    private func sendWSFrameDict(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else { return }
        sendWSFrame(text)
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
        let ik              = keyStorage.getOrCreateIdentityKey()
        let (spk, sig)      = keyStorage.getOrCreateSignedPreKey()
        let spkId           = keyStorage.getOrCreateSpkId()
        let opks            = keyStorage.generateOneTimePreKeys(count: 10)
        let deviceId        = keyStorage.getOrCreateDeviceId()

        let req = RegisterKeysRequest(
            deviceName:  deviceId,
            ikPublic:    Data(ik.publicKey).base64EncodedString(),
            spkId:       spkId,
            spkPublic:   Data(spk.publicKey).base64EncodedString(),
            spkSignature: Data(sig).base64EncodedString(),
            opkPublics:  opks.map { Data($0.publicKey).base64EncodedString() }
        )
        do {
            let resp = try await client.registerKeys(req)
            resp.opkIds.enumerated().forEach { (index, opkId) in
                if index < opks.count {
                    keyStorage.saveOneTimePreKeySecret(opks[index].secretKey, id: opkId)
                }
            }
        } catch {
            print("Failed to register keys: \(error)")
        }
    }

    // MARK: - Calls

    func initiateCall(chatId: String, isVideo: Bool) {
        let callId   = UUID().uuidString
        let targetId = chatStore.chats.first(where: { $0.id == chatId })?.members
                                      .first(where: { $0 != authState.userId }) ?? ""
        chatStore.setOutgoingCall(callId: callId, chatId: chatId,
                                  targetId: targetId, isVideo: isVideo)
#if canImport(WebRTC)
        resetVideoViews()
        let controller = makeController(callId: callId, chatId: chatId,
                                        isVideo: isVideo, msgType: "call_offer")
        webRtcController = controller
        Task {
            let servers = await fetchRtcIceServers()
            controller.startCall(callId: callId, iceServers: servers, isVideo: isVideo)
        }
#else
        sendWSFrameDict(["type": "call_offer", "callId": callId,
                         "chatId": chatId, "sdp": "stub-sdp", "isVideo": isVideo])
#endif
    }

    func acceptCall() {
        let cs = chatStore.callState
        guard cs.status == .ringingIn else { return }
        // Переход в active сразу, как на Android
        chatStore.onCallAnswer(callId: cs.callId)
#if canImport(WebRTC)
        let offerSdp = pendingIncomingOfferSdp ?? ""
        pendingIncomingOfferSdp = nil
        resetVideoViews()
        let controller = makeController(callId: cs.callId, chatId: cs.chatId,
                                        isVideo: cs.isVideo, msgType: "call_answer")
        webRtcController = controller
        Task {
            let servers = await fetchRtcIceServers()
            controller.answerCall(callId: cs.callId, remoteSdp: offerSdp,
                                  iceServers: servers, isVideo: cs.isVideo)
        }
#else
        sendWSFrameDict(["type": "call_answer", "callId": cs.callId, "sdp": "stub-sdp"])
#endif
    }

    func rejectCall() {
        let cs = chatStore.callState
        sendWSFrameDict(["type": "call_reject", "callId": cs.callId])
        pendingIncomingOfferSdp = nil
        chatStore.clearCall()
#if canImport(WebRTC)
        webRtcController?.release()
        webRtcController = nil
#endif
    }

    func hangUp() {
        let cs = chatStore.callState
        sendWSFrameDict(["type": "call_end", "callId": cs.callId])
        chatStore.clearCall()
#if canImport(WebRTC)
        webRtcController?.release()
        webRtcController = nil
#endif
    }

    /// Привязать MTL-views к контроллеру (вызывается из CallOverlay при появлении).
#if canImport(WebRTC)
    func bindVideoRenderers(local: RTCVideoRenderer, remote: RTCVideoRenderer) {
        webRtcController?.bindRenderers(local: local, remote: remote)
    }
#endif

    // MARK: - WebRTC helpers

#if canImport(WebRTC)
    /// Создаёт controller и навешивает все callbacks.
    /// msgType: "call_offer" — для caller, "call_answer" — для callee.
    private func makeController(callId: String, chatId: String,
                                 isVideo: Bool, msgType: String) -> iOSWebRtcController {
        let c = iOSWebRtcController()

        c.onLocalSdpReady = { [weak self] cId, sdp in
            guard let self else { return }
            var frame: [String: Any] = ["type": msgType, "callId": cId, "sdp": sdp]
            if msgType == "call_offer" { frame["chatId"] = chatId; frame["isVideo"] = isVideo }
            self.sendWSFrameDict(frame)
        }

        c.onIceCandidateReady = { [weak self] cId, candidate, sdpMid, sdpMLineIndex in
            guard let self else { return }
            self.sendWSFrameDict([
                "type": "ice_candidate", "callId": cId,
                "candidate": candidate, "sdpMid": sdpMid,
                "sdpMLineIndex": sdpMLineIndex
            ])
        }

        c.onLocalVideoReady  = { [weak self] in self?.chatStore.markLocalVideoReady() }
        c.onRemoteVideoReady = { [weak self] in self?.chatStore.markRemoteVideoReady() }
        c.onError            = { [weak self] err in
            Task { @MainActor in
                guard let self else { return }
                self.chatStore.setCallError("Ошибка звонка: \(err.localizedDescription)")
                self.chatStore.clearCall()
                self.webRtcController?.release()
                self.webRtcController = nil
            }
        }

        return c
    }

    private func fetchRtcIceServers() async -> [RTCIceServer] {
        guard let client = apiClient,
              let resp   = try? await client.fetchIceServers() else {
            return [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        }
        return resp.iceServers.map {
            RTCIceServer(urlStrings: [$0.urls],
                         username: $0.username ?? "",
                         credential: $0.credential ?? "")
        }
    }

    private func resetVideoViews() {
        localVideoView  = RTCMTLVideoView()
        remoteVideoView = RTCMTLVideoView()
    }
#endif

    // MARK: - Init

    init() {
        let saved = UserDefaults.standard.string(forKey: "messenger.server.url") ?? ""
        let url = saved.isEmpty ? BuildConfig.defaultServerUrl : saved
        if !url.isEmpty {
            if saved.isEmpty {
                UserDefaults.standard.set(url, forKey: "messenger.server.url")
            }
            setupComponents(baseURL: url)
            isServerConfigured = true
        }
    }
}
