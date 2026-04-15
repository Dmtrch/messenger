// ChatListScreen.swift — список чатов с поиском.
// Зеркало ChatListScreen.kt (Android/Desktop).

import SwiftUI

struct ChatListScreen: View {
    @EnvironmentObject var vm: AppViewModel
    let onChatSelected: (ChatItem) -> Void

    @State private var searchText = ""
    @State private var isLoading  = false

    private var filteredChats: [ChatItem] {
        if searchText.isEmpty { return vm.chatStore.chats }
        return vm.chatStore.chats.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        List(filteredChats) { chat in
            Button { onChatSelected(chat) } label: {
                ChatRow(chat: chat)
            }
            .buttonStyle(.plain)
        }
        .searchable(text: $searchText, prompt: "Поиск чатов")
        .navigationTitle("Чаты")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                NavigationLink {
                    ProfileScreen()
                } label: {
                    Image(systemName: "person.circle")
                }
            }
        }
        .refreshable {
            try? await vm.loadChats()
        }
        .overlay {
            if isLoading { ProgressView() }
        }
        .task {
            isLoading = true
            try? await vm.loadChats()
            isLoading = false
        }
    }
}

// MARK: - Chat row

private struct ChatRow: View {
    let chat: ChatItem

    var body: some View {
        HStack(spacing: 12) {
            // Аватар
            ZStack {
                Circle()
                    .fill(chat.isGroup ? Color.blue.opacity(0.2) : Color.purple.opacity(0.2))
                    .frame(width: 48, height: 48)
                Text(chat.name.prefix(1).uppercased())
                    .font(.headline)
                    .foregroundStyle(chat.isGroup ? .blue : .purple)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(chat.name)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Text(formattedDate(chat.updatedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text(chat.lastMessage ?? "")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    if chat.unreadCount > 0 {
                        Text("\(chat.unreadCount)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.accentColor)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formattedDate(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let formatter = DateFormatter()
        if Calendar.current.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
        } else {
            formatter.dateFormat = "dd.MM"
        }
        return formatter.string(from: date)
    }
}
