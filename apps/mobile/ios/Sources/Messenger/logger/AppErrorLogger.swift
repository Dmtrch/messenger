// AppErrorLogger.swift — централизованное логирование ошибок iOS.
//
// Записывает структурированные JSON-строки в Documents/logs/errors.log.
// При превышении 5 МБ ротирует файл (→ errors.log.old).
// Перехватывает непойманные исключения через NSSetUncaughtExceptionHandler.
// При старте приложения отправляет накопленные логи на /api/client-errors.
import Foundation
import os

final class AppErrorLogger {

    static let shared = AppErrorLogger()

    private let maxSize: Int64 = 5 * 1024 * 1024 // 5 МБ
    private let flushLines = 100
    private let logger     = Logger(subsystem: "com.messenger", category: "errors")
    private let queue      = DispatchQueue(label: "com.messenger.errorlogger", qos: .background)
    private var logFile: URL?

    private init() {}

    // MARK: - Инициализация

    func initialize() {
        let logsDir = resolveLogsDir()
        try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
        logFile = logsDir.appendingPathComponent("errors.log")
        installCrashHandler()
    }

    // MARK: - Публичный API

    func error(_ tag: String, _ message: String, _ error: Error? = nil) {
        logger.error("[\(tag)] \(message)\(error.map { ": \($0)" } ?? "")")
        append(level: "error", tag: tag, message: message,
               stack: error.map { "\($0)" })
    }

    func warn(_ tag: String, _ message: String) {
        logger.warning("[\(tag)] \(message)")
        append(level: "warn", tag: tag, message: message, stack: nil)
    }

    func info(_ tag: String, _ message: String) {
        logger.info("[\(tag)] \(message)")
        append(level: "info", tag: tag, message: message, stack: nil)
    }

    /// Отправить накопленные логи на сервер (вызвать при старте приложения).
    func flushToServer(serverUrl: String) {
        guard !serverUrl.isEmpty, let file = logFile else { return }
        queue.async { self.doFlush(file: file, serverUrl: serverUrl) }
    }

    // MARK: - Внутренние методы

    private func resolveLogsDir() -> URL {
#if canImport(UIKit)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
        return docs.appendingPathComponent("logs")
#else
        // macOS (не используется при swift test, но нужен для компиляции)
        return URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".messenger/logs")
#endif
    }

    private func append(level: String, tag: String, message: String, stack: String?) {
        queue.async { [weak self] in
            guard let self, let fileUrl = self.logFile else { return }
            do {
                // Ротация при превышении лимита.
                if let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path),
                   let size = attrs[.size] as? Int64, size > self.maxSize {
                    let old = fileUrl.deletingLastPathComponent()
                        .appendingPathComponent("errors.log.old")
                    try? FileManager.default.removeItem(at: old)
                    try? FileManager.default.moveItem(at: fileUrl, to: old)
                }

                let ts = ISO8601DateFormatter().string(from: Date())
                var obj: [String: Any] = [
                    "timestamp": ts,
                    "level":     level,
                    "tag":       tag,
                    "message":   message,
                    "platform":  "ios"
                ]
                if let stack { obj["stack"] = stack }

                let data = try JSONSerialization.data(withJSONObject: obj)
                var line = data
                line.append(contentsOf: [0x0A]) // "\n"

                if FileManager.default.fileExists(atPath: fileUrl.path) {
                    let handle = try FileHandle(forWritingTo: fileUrl)
                    handle.seekToEndOfFile()
                    handle.write(line)
                    handle.closeFile()
                } else {
                    try line.write(to: fileUrl)
                }
            } catch {
                self.logger.error("Failed to write log: \(error)")
            }
        }
    }

    private func installCrashHandler() {
        NSSetUncaughtExceptionHandler { exception in
            AppErrorLogger.shared.append(
                level: "error",
                tag:   "UncaughtException",
                message: exception.name.rawValue + ": " + (exception.reason ?? ""),
                stack:   exception.callStackSymbols.joined(separator: "\n")
            )
            // Небольшая пауза, чтобы запись успела завершиться.
            Thread.sleep(forTimeInterval: 0.3)
        }
    }

    private func doFlush(file: URL, serverUrl: String) {
        guard let content = try? String(contentsOf: file, encoding: .utf8) else { return }
        let lines = content.components(separatedBy: "\n")
            .filter { !$0.isEmpty }
            .prefix(flushLines)
        guard !lines.isEmpty else { return }

        var entries: [[String: Any]] = []
        for line in lines {
            guard let data = line.data(using: .utf8),
                  let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }
            var entry: [String: Any] = [
                "timestamp": obj["timestamp"] ?? "",
                "level":     obj["level"]     ?? "error",
                "userId":    "",
                "route":     "ios",
                "message":   "[\(obj["tag"] ?? "")] \(obj["message"] ?? "")"
            ]
            if let stack = obj["stack"] as? String, !stack.isEmpty {
                entry["details"] = stack
            }
            entries.append(entry)
        }
        guard !entries.isEmpty else { return }

        guard let body = try? JSONSerialization.data(withJSONObject: ["entries": entries]),
              let url  = URL(string: "\(serverUrl)/api/client-errors")
        else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            defer { sem.signal() }
            if (resp as? HTTPURLResponse)?.statusCode == 204 {
                // Удалить отправленные строки.
                let allLines = (try? String(contentsOf: file, encoding: .utf8))?
                    .components(separatedBy: "\n").filter { !$0.isEmpty } ?? []
                let remaining = Array(allLines.dropFirst(lines.count))
                let newContent = remaining.isEmpty ? "" : remaining.joined(separator: "\n") + "\n"
                try? newContent.write(to: file, atomically: true, encoding: .utf8)
            }
        }.resume()
        sem.wait()
    }
}
