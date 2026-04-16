import SwiftUI

struct NewChatScreen: View {
    @EnvironmentObject var vm: AppViewModel
    let onBack: () -> Void
    let onChatCreated: (String) -> Void
    
    @State private var mode: String = "direct"
    @State private var query: String = ""
    @State private var results: [UserResultDto] = []
    @State private var selected: [UserResultDto] = []
    @State private var groupName: String = ""
    @State private var loading: Bool = false
    @State private var creating: Bool = false
    @State private var error: String? = nil
    
    var body: some View {
        VStack(spacing: 0) {
            Picker("Режим", selection: $mode) {
                Text("Личный").tag("direct")
                Text("Группа").tag("group")
            }
            .pickerStyle(.segmented)
            .padding()
            
            if mode == "group" {
                TextField("Название группы", text: $groupName)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
                
                if !selected.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(selected, id: \.id) { user in
                                HStack {
                                    Text(user.displayName.isEmpty ? user.username : user.displayName)
                                    Button {
                                        selected.removeAll { $0.id == user.id }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                    }
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.accentColor.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 20))
                            }
                        }
                        .padding()
                    }
                }
            }
            
            TextField("Поиск пользователей...", text: $query)
                .textFieldStyle(.roundedBorder)
                .padding()
                .autocapitalization(.none)
                .disableAutocorrection(true)
            
            if loading {
                ProgressView()
                    .padding()
            }
            
            if let error = error {
                Text(error)
                    .foregroundColor(.red)
                    .padding()
            }
            
            List(results, id: \.id) { user in
                HStack {
                    VStack(alignment: .leading) {
                        Text(user.displayName.isEmpty ? user.username : user.displayName)
                            .font(.headline)
                        Text("@\(user.username)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    if mode == "group" {
                        Button {
                            if !selected.contains(where: { $0.id == user.id }) {
                                selected.append(user)
                                query = ""
                                results = []
                            }
                        } label: {
                            Image(systemName: "plus.circle")
                                .font(.title2)
                        }
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    if mode == "direct" {
                        createChat(userIds: [user.id], name: nil)
                    }
                }
            }
            
            if mode == "group" {
                Button {
                    createChat(userIds: selected.map { $0.id }, name: groupName)
                } label: {
                    if creating {
                        ProgressView()
                    } else {
                        Text("Создать группу (\(selected.count))")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .padding()
                .disabled(creating || selected.count < 2 || groupName.isEmpty)
            }
        }
        .navigationTitle("Новый чат")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Отмена", action: onBack)
            }
        }
        .onChange(of: query) { newValue in
            search()
        }
    }
    
    private func search() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            return
        }
        
        Task {
            loading = true
            error = nil
            do {
                if let client = vm.apiClient {
                    let resp = try await client.searchUsers(query: trimmed)
                    if mode == "group" {
                        results = resp.users.filter { u in !selected.contains(where: { $0.id == u.id }) }
                    } else {
                        results = resp.users
                    }
                }
            } catch {
                self.error = "Ошибка поиска"
            }
            loading = false
        }
    }
    
    private func createChat(userIds: [String], name: String?) {
        Task {
            creating = true
            error = nil
            do {
                if let client = vm.apiClient {
                    let resp = try await client.createChat(type: mode, memberIds: userIds, name: name)
                    onChatCreated(resp.chat.id)
                }
            } catch {
                self.error = "Ошибка создания чата"
            }
            creating = false
        }
    }
}
