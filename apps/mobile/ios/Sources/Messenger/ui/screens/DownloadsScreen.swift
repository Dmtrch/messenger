// DownloadsScreen.swift — экран загрузок (манифест + скачивание артефактов).
// Зеркало DownloadsScreen.kt (Desktop/Android) и /downloads на PWA.

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct DownloadsScreen: View {
    @EnvironmentObject var vm: AppViewModel

    @State private var manifest: DownloadsManifestDto? = nil
    @State private var loadError: String? = nil
    @State private var busyFilename: String? = nil
    @State private var resultText: String? = nil
    @State private var shareURL: URL? = nil

    var body: some View {
        List {
            if let err = loadError {
                Section { Text("Ошибка: \(err)").foregroundStyle(.red) }
            } else if let m = manifest {
                Section("Версия \(m.version)") {
                    if let log = m.changelog, !log.isEmpty {
                        Text(log)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if m.artifacts.isEmpty {
                    Section { Text("Артефакты не опубликованы") }
                } else {
                    Section("Артефакты") {
                        ForEach(m.artifacts, id: \.filename) { art in
                            ArtifactRowView(
                                art: art,
                                busy: busyFilename == art.filename,
                                onDownload: { download(art) }
                            )
                        }
                    }
                }
                if let text = resultText {
                    Section { Text(text).font(.footnote).foregroundStyle(.secondary) }
                }
            } else {
                Section { ProgressView() }
            }
        }
        .navigationTitle("Загрузки")
        .task { await loadManifest() }
        .sheet(item: Binding(
            get: { shareURL.map { IdentifiableURL(url: $0) } },
            set: { shareURL = $0?.url }
        )) { wrapper in
            ShareSheet(url: wrapper.url)
        }
    }

    private func loadManifest() async {
        guard let client = vm.apiClient else {
            loadError = "Не авторизован"; return
        }
        do { manifest = try await client.getDownloadsManifest() }
        catch { loadError = error.localizedDescription }
    }

    private func download(_ art: DownloadArtifactDto) {
        guard let client = vm.apiClient else { return }
        busyFilename = art.filename
        resultText = nil
        Task {
            defer { busyFilename = nil }
            do {
                let data = try await client.downloadArtifact(filename: art.filename)
                let url = try saveToDocuments(filename: art.filename, data: data)
                resultText = "Сохранено: \(url.path)"
                shareURL = url
            } catch {
                resultText = "Ошибка: \(error.localizedDescription)"
            }
        }
    }

    private func saveToDocuments(filename: String, data: Data) throws -> URL {
        let dir = try FileManager.default.url(for: .documentDirectory,
                                              in: .userDomainMask,
                                              appropriateFor: nil, create: true)
        let url = dir.appendingPathComponent(filename)
        try data.write(to: url, options: .atomic)
        return url
    }
}

private struct ArtifactRowView: View {
    let art: DownloadArtifactDto
    let busy: Bool
    let onDownload: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(art.filename).font(.body.weight(.semibold))
            Text("\(art.platform.isEmpty ? "-" : art.platform) · \(art.arch.isEmpty ? "-" : art.arch) · \(art.format) · \(formatSize(art.sizeBytes))")
                .font(.caption)
                .foregroundStyle(.secondary)
            if !art.sha256.isEmpty {
                Text("SHA-256 \(String(art.sha256.prefix(16)))…")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button(action: onDownload) {
                    if busy {
                        ProgressView()
                    } else {
                        Label("Скачать", systemImage: "arrow.down.circle")
                    }
                }
                .disabled(busy)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, 4)
    }
}

private func formatSize(_ bytes: Int64) -> String {
    if bytes <= 0 { return "—" }
    let kb = Double(bytes) / 1024.0
    let mb = kb / 1024.0
    if mb >= 1 { return String(format: "%.1f МБ", mb) }
    return String(format: "%.0f КБ", kb)
}

// MARK: - Share sheet helpers

private struct IdentifiableURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

#if canImport(UIKit)
private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#else
private struct ShareSheet: View {
    let url: URL
    var body: some View { Text(url.path) }
}
#endif
