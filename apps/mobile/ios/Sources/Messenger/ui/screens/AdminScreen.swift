// AdminScreen.swift — экран администрирования (Пользователи / Заявки / Сбросы).
// Зеркало AdminScreen.kt (Desktop/Android) и AdminPage.tsx (PWA).

import SwiftUI

private enum AdminTab: String, CaseIterable, Identifiable {
    case users = "Польз."
    case registrations = "Заявки"
    case resets = "Сбросы"
    case invites = "Инвайты"
    case settings = "Настр."
    case system = "Систем."
    var id: String { rawValue }
}

struct AdminScreen: View {
    @EnvironmentObject var vm: AppViewModel

    @State private var tab: AdminTab = .users
    @State private var users: [AdminUserDto] = []
    @State private var regs: [AdminRegRequestDto] = []
    @State private var resets: [AdminResetRequestDto] = []
    @State private var invites: [AdminInviteCodeDto] = []
    @State private var retentionDays: Int = 0
    @State private var maxMembers: Int = 0
    @State private var sysStats: AdminSystemStatsDto? = nil
    @State private var error: String? = nil
    @State private var info: String? = nil
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Вкладка", selection: $tab) {
                ForEach(AdminTab.allCases) { t in Text(t.rawValue).tag(t) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 8)

            if let err = error {
                Text("Ошибка: \(err)").foregroundStyle(.red).padding(.horizontal)
            }
            if let msg = info {
                Text(msg).foregroundStyle(.secondary).padding(.horizontal)
            }

            switch tab {
            case .users:         UsersListView(users: users, onAction: runAction)
            case .registrations: RegistrationsListView(requests: regs,
                                                      onApprove: { id in runAction { try await $0.adminApproveRegistration(id) } },
                                                      onReject:  { id in runAction { try await $0.adminRejectRegistration(id) } })
            case .resets:        ResetsListView(requests: resets,
                                                onResolve: { id, tmp in runAction { try await $0.adminResolveReset(id, tempPassword: tmp) } })
            case .invites:       InvitesListView(codes: invites,
                                                 onCreate: { runAction { _ = try await $0.adminCreateInviteCode() } },
                                                 onRevoke: { code in runAction { try await $0.adminRevokeInviteCode(code) } })
            case .settings:      SettingsPaneView(retentionDays: retentionDays, maxMembers: maxMembers,
                                                  onSaveRetention: { v in runAction { try await $0.adminSetRetention(v) } },
                                                  onSaveMaxMembers: { v in runAction { try await $0.adminSetMaxGroupMembers(v) } })
            case .system:        SystemPaneView(stats: sysStats)
            }
        }
        .navigationTitle("Админ")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: { Task { await reload() } }) {
                    if isLoading { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
            }
        }
        .task { await reload() }
    }

    private func reload() async {
        guard let client = vm.apiClient else { error = "Не авторизован"; return }
        isLoading = true; error = nil
        async let u = tryFetch { try await client.adminListUsers() }
        async let r = tryFetch { try await client.adminListRegistrationRequests() }
        async let p = tryFetch { try await client.adminListResetRequests() }
        async let i = tryFetch { try await client.adminListInviteCodes() }
        async let rd = tryFetch { try await client.adminGetRetention() }
        async let mm = tryFetch { try await client.adminGetMaxGroupMembers() }
        async let s = tryFetch { try await client.adminGetSystemStats() }
        let (uu, rr, pp, ii, rdd, mmm, ss) = await (u, r, p, i, rd, mm, s)
        users = uu ?? []
        regs = rr ?? []
        resets = pp ?? []
        invites = ii ?? []
        retentionDays = rdd ?? 0
        maxMembers = mmm ?? 0
        sysStats = ss
        isLoading = false
    }

    private func tryFetch<T>(_ op: () async throws -> T) async -> T? {
        do { return try await op() }
        catch { self.error = (self.error ?? "") + " " + error.localizedDescription; return nil }
    }

    private func runAction(_ action: @escaping (ApiClient) async throws -> Void) {
        guard let client = vm.apiClient else { return }
        Task {
            do {
                try await action(client)
                info = "Готово"
                await reload()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Users

private struct UsersListView: View {
    let users: [AdminUserDto]
    let onAction: (@escaping (ApiClient) async throws -> Void) -> Void

    @State private var roleUser: AdminUserDto? = nil
    @State private var resetUser: AdminUserDto? = nil

    var body: some View {
        List(users) { u in
            VStack(alignment: .leading, spacing: 4) {
                Text("\(u.username) · \(u.role)").font(.body.weight(.semibold))
                Text("status=\(u.status)\(u.displayName.isEmpty ? "" : " · \(u.displayName)")")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Button("Suspend") { onAction { try await $0.adminSuspendUser(u.id) } }
                    Button("Unsuspend") { onAction { try await $0.adminUnsuspendUser(u.id) } }
                    Button("Ban") { onAction { try await $0.adminBanUser(u.id) } }
                }
                .buttonStyle(.bordered)
                .font(.caption)
                HStack(spacing: 8) {
                    Button("Revoke") { onAction { try await $0.adminRevokeSessions(u.id) } }
                    Button("Wipe", role: .destructive) { onAction { try await $0.adminRemoteWipe(u.id) } }
                    Button("Роль…") { roleUser = u }
                    Button("Пароль…") { resetUser = u }
                }
                .buttonStyle(.bordered)
                .font(.caption)
            }
            .padding(.vertical, 4)
        }
        .sheet(item: $roleUser) { u in RoleSheet(user: u, onSave: { role in onAction { try await $0.adminSetUserRole(u.id, role: role) } }) }
        .sheet(item: $resetUser) { u in ResetSheet(user: u, onSave: { pwd in onAction { try await $0.adminResetUserPassword(u.id, newPassword: pwd) } }) }
    }
}

private struct RoleSheet: View {
    let user: AdminUserDto
    let onSave: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var role: String
    init(user: AdminUserDto, onSave: @escaping (String) -> Void) {
        self.user = user; self.onSave = onSave
        _role = State(initialValue: user.role)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Роль для \(user.username)") {
                    Picker("Роль", selection: $role) {
                        ForEach(["user", "moderator", "admin"], id: \.self) { Text($0).tag($0) }
                    }
                }
                Button("Сохранить") { onSave(role); dismiss() }
            }
            .navigationTitle("Смена роли")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Отмена") { dismiss() } }
            }
        }
    }
}

private struct ResetSheet: View {
    let user: AdminUserDto
    let onSave: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pwd = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("Новый пароль для \(user.username)") {
                    SecureField("Пароль (≥ 8 символов)", text: $pwd)
                }
                Button("Сохранить") {
                    if pwd.count >= 8 { onSave(pwd); dismiss() }
                }.disabled(pwd.count < 8)
            }
            .navigationTitle("Сброс пароля")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Отмена") { dismiss() } }
            }
        }
    }
}

// MARK: - Registrations

private struct RegistrationsListView: View {
    let requests: [AdminRegRequestDto]
    let onApprove: (String) -> Void
    let onReject: (String) -> Void

    var body: some View {
        if requests.isEmpty {
            ContentUnavailableView("Заявок нет", systemImage: "tray")
        } else {
            List(requests) { r in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(r.username) (\(r.displayName))").font(.body.weight(.semibold))
                    Text("status=\(r.status)").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Одобрить") { onApprove(r.id) }.buttonStyle(.borderedProminent)
                        Button("Отклонить") { onReject(r.id) }.buttonStyle(.bordered)
                    }.font(.caption)
                }
                .padding(.vertical, 4)
            }
        }
    }
}

// MARK: - Resets

private struct ResetsListView: View {
    let requests: [AdminResetRequestDto]
    let onResolve: (String, String) -> Void

    @State private var targetId: String? = nil
    @State private var tmp = ""

    var body: some View {
        Group {
            if requests.isEmpty {
                ContentUnavailableView("Заявок нет", systemImage: "tray")
            } else {
                List(requests) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.username).font(.body.weight(.semibold))
                        Text("status=\(r.status)").font(.caption).foregroundStyle(.secondary)
                        Button("Выдать временный пароль") { targetId = r.id; tmp = "" }
                            .buttonStyle(.bordered).font(.caption)
                    }.padding(.vertical, 4)
                }
            }
        }
        .alert("Временный пароль", isPresented: Binding(
            get: { targetId != nil },
            set: { if !$0 { targetId = nil } }
        )) {
            SecureField("Пароль (≥8)", text: $tmp)
            Button("Выдать") {
                if let id = targetId, tmp.count >= 8 { onResolve(id, tmp) }
                targetId = nil
            }
            Button("Отмена", role: .cancel) { targetId = nil }
        }
    }
}

// MARK: - Invites

private struct InvitesListView: View {
    let codes: [AdminInviteCodeDto]
    let onCreate: () -> Void
    let onRevoke: (String) -> Void
    var body: some View {
        List {
            Section {
                Button("Сгенерировать новый код", action: onCreate)
                    .buttonStyle(.borderedProminent)
            }
            if codes.isEmpty {
                Section { Text("Инвайтов нет") }
            } else {
                Section("Коды") {
                    ForEach(codes) { c in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(c.code).font(.body.weight(.semibold).monospaced())
                            let status: String = {
                                if c.revokedAt > 0 { return "revoked" }
                                if c.usedAt > 0 { return "used by \(c.usedBy)" }
                                let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
                                if c.expiresAt > 0 && c.expiresAt < nowMs { return "expired" }
                                return "active"
                            }()
                            Text("status=\(status)").font(.caption).foregroundStyle(.secondary)
                            if c.revokedAt == 0 && c.usedAt == 0 {
                                Button("Отозвать", role: .destructive) { onRevoke(c.code) }
                                    .buttonStyle(.bordered).font(.caption)
                            }
                        }.padding(.vertical, 4)
                    }
                }
            }
        }
    }
}

// MARK: - Settings

private struct SettingsPaneView: View {
    let retentionDays: Int
    let maxMembers: Int
    let onSaveRetention: (Int) -> Void
    let onSaveMaxMembers: (Int) -> Void

    @State private var rd: String = ""
    @State private var mm: String = ""

    var body: some View {
        Form {
            Section("Хранение медиа (дней)") {
                TextField("retentionDays", text: $rd)
                Button("Сохранить") {
                    if let v = Int(rd) { onSaveRetention(v) }
                }.disabled(Int(rd) == nil)
            }
            Section("Макс. участников в группе") {
                TextField("maxMembers", text: $mm)
                Button("Сохранить") {
                    if let v = Int(mm) { onSaveMaxMembers(v) }
                }.disabled(Int(mm) == nil)
            }
        }
        .onAppear {
            rd = String(retentionDays)
            mm = String(maxMembers)
        }
        .onChange(of: retentionDays) { rd = String($0) }
        .onChange(of: maxMembers) { mm = String($0) }
    }
}

// MARK: - System

private struct SystemPaneView: View {
    let stats: AdminSystemStatsDto?
    var body: some View {
        Form {
            if let s = stats {
                LabeledContent("CPU", value: String(format: "%.1f%%", s.cpuPercent))
                LabeledContent("RAM", value: "\(formatBytes(s.ramUsed)) / \(formatBytes(s.ramTotal))")
                LabeledContent("Disk", value: "\(formatBytes(s.diskUsed)) / \(formatBytes(s.diskTotal))")
            } else {
                Text("Нет данных")
            }
        }
    }
    private func formatBytes(_ b: Int64) -> String {
        if b <= 0 { return "0" }
        let gb = Double(b) / 1024.0 / 1024.0 / 1024.0
        let mb = Double(b) / 1024.0 / 1024.0
        return gb >= 1 ? String(format: "%.2f ГБ", gb) : String(format: "%.1f МБ", mb)
    }
}
