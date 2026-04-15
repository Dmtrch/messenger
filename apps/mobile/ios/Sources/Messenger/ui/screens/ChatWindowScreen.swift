// ChatWindowScreen.swift — экран переписки.
// Зеркало ChatWindowScreen.kt (Android/Desktop).

import SwiftUI
import UniformTypeIdentifiers

struct ChatWindowScreen: View {
    let chatId:   String
    let chatName: String

    @EnvironmentObject var vm: AppViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var inputText   = ""
    @State private var isShowingFilePicker = false
    @State private var scrollToBottom = false

    private var messages: [MessageItem] { vm.chatStore.messages[chatId] ?? [] }
    private var typingUsers: Set<String> { vm.chatStore.typing[chatId] ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            // Список сообщений
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(messages) { msg in
                            MessageBubble(message: msg,
                                          isMine: msg.senderId == vm.authState.userId,
                                          onDownload: { mediaId, mediaKey, name in
                                await downloadFile(mediaId: mediaId, mediaKey: mediaKey, name: name)
                            })
                            .id(msg.id)
                        }
                        if !typingUsers.isEmpty {
                            TypingIndicator(users: typingUsers)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                }
                .onChange(of: messages.count) {
                    withAnimation { proxy.scrollTo("bottom") }
                }
                .task { withAnimation { proxy.scrollTo("bottom") } }
            }

            // Input bar
            Divider()
            HStack(spacing: 8) {
                Button { isShowingFilePicker = true } label: {
                    Image(systemName: "paperclip")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                TextField("Сообщение…", text: $inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)

                Button {
                    guard !inputText.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    let text = inputText
                    inputText = ""
                    Task { await vm.sendMessage(chatId: chatId, plaintext: text) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(inputText.isEmpty ? .secondary : .accentColor)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .navigationTitle(chatName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    vm.initiateCall(chatId: chatId, isVideo: false)
                } label: {
                    Image(systemName: "phone")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    vm.initiateCall(chatId: chatId, isVideo: true)
                } label: {
                    Image(systemName: "video")
                }
            }
        }
        .fileImporter(isPresented: $isShowingFilePicker,
                      allowedContentTypes: [.data, .image, .movie]) { result in
            if case .success(let url) = result {
                Task { await uploadFile(url: url) }
            }
        }
        .alert("Ошибка загрузки", isPresented: .constant(vm.uploadError != nil)) {
            Button("OK") { vm.clearUploadError() }
        } message: {
            Text(vm.uploadError ?? "")
        }
    }

    private func uploadFile(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let data = try? Data(contentsOf: url) else { return }
        let mime = url.pathExtension.isEmpty ? "application/octet-stream"
                     : UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                         ?? "application/octet-stream"
        await vm.uploadMedia(data: data, filename: url.lastPathComponent,
                              contentType: mime, chatId: chatId)
    }

    private func downloadFile(mediaId: String, mediaKey: String, name: String) async {
        guard let client = vm.apiClient else { return }
        guard let data = try? await client.fetchDecryptedMedia(mediaId: mediaId, mediaKeyBase64: mediaKey) else { return }
        // Сохранить в Documents
        let docDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let target = docDir.appendingPathComponent(name)
        try? data.write(to: target)
    }
}

// MARK: - Message bubble

struct MessageBubble: View {
    let message: MessageItem
    let isMine: Bool
    let onDownload: (String, String, String) async -> Void

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 60) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                if let mediaId = message.mediaId, let mediaKey = message.mediaKey {
                    // Файл/медиа
                    FileCard(
                        name: message.originalName ?? "file",
                        contentType: message.contentType,
                        onDownload: { await onDownload(mediaId, mediaKey, message.originalName ?? "file") }
                    )
                } else {
                    Text(message.isDeleted ? "Сообщение удалено" : message.plaintext)
                        .padding(10)
                        .background(isMine ? Color.accentColor : Color(.systemGray5))
                        .foregroundStyle(isMine ? .white : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .italic(message.isDeleted)
                        .foregroundStyle(message.isDeleted ? .secondary : (isMine ? .white : .primary))
                }
                HStack(spacing: 4) {
                    Text(formattedTime(message.timestamp))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if isMine {
                        Image(systemName: statusIcon(message.status))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if !isMine { Spacer(minLength: 60) }
        }
    }

    private func statusIcon(_ status: String) -> String {
        switch status {
        case "sending":   return "clock"
        case "sent":      return "checkmark"
        case "delivered": return "checkmark.circle"
        case "read":      return "checkmark.circle.fill"
        default:          return "checkmark"
        }
    }

    private func formattedTime(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}

// MARK: - File card

struct FileCard: View {
    let name: String
    let contentType: String?
    let onDownload: () async -> Void
    @State private var isDownloading = false

    private var isImage: Bool { contentType?.hasPrefix("image/") ?? false }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isImage ? "photo" : "doc")
                .font(.title2)
                .foregroundStyle(.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.subheadline).lineLimit(1)
                Text(contentType ?? "Файл").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                isDownloading = true
                Task {
                    await onDownload()
                    isDownloading = false
                }
            } label: {
                if isDownloading {
                    ProgressView().scaleEffect(0.7)
                } else {
                    Image(systemName: "arrow.down.circle")
                        .foregroundStyle(.accentColor)
                }
            }
            .disabled(isDownloading)
        }
        .padding(10)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: 260)
    }
}

// MARK: - Typing indicator

struct TypingIndicator: View {
    let users: Set<String>

    var body: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 6, height: 6)
                        .opacity(0.5)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemGray5))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            Spacer()
        }
    }
}
