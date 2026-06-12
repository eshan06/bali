import Foundation

/// NDEF desk-tag reading — device-only (the Simulator keeps the tag-entry sheet).
/// Tags carry either the bare 10-char code (T4 writes NDEF text) or the QR's URL
/// (https://<web>/t/<code>); both resolve through the same tags/resolve call.
enum NFCTagRead {
    static func extractCode(fromText text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let pattern = "^[A-Z0-9]{10}$"
        return trimmed.range(of: pattern, options: .regularExpression) != nil ? trimmed : nil
    }

    static func extractCode(fromURL url: URL) -> String? {
        // https://<host>/t/<code>  or  bali://t/<code>
        let parts = url.pathComponents.filter { $0 != "/" }
        if let idx = parts.firstIndex(of: "t"), idx + 1 < parts.count {
            return extractCode(fromText: parts[idx + 1])
        }
        if url.host == "t", let code = parts.first {
            return extractCode(fromText: code)
        }
        return parts.last.flatMap(extractCode(fromText:))
    }
}

#if !targetEnvironment(simulator) && canImport(CoreNFC)
@preconcurrency import CoreNFC

/// One scan per call, bridged to async/await — same shape the legacy reader proved.
final class TagCodeReader: NSObject, NFCNDEFReaderSessionDelegate, @unchecked Sendable {
    static var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    private var session: NFCNDEFReaderSession?
    private var continuation: CheckedContinuation<String, Error>?

    enum ScanError: LocalizedError {
        case cancelled
        case notABaliTag
        case failed(String)
        var errorDescription: String? {
            switch self {
            case .cancelled: return nil
            case .notABaliTag: return "This doesn't look like a Bali tag."
            case .failed(let message): return message
            }
        }
    }

    func scan() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
            session.alertMessage = "Hold your iPhone near the desk tag."
            self.session = session
            session.begin()
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        for message in messages {
            for record in message.records {
                if let url = record.wellKnownTypeURIPayload(),
                   let code = NFCTagRead.extractCode(fromURL: url) {
                    finish(session, code: code)
                    return
                }
                let (text, _) = record.wellKnownTypeTextPayload()
                if let text, let code = NFCTagRead.extractCode(fromText: text) {
                    finish(session, code: code)
                    return
                }
            }
        }
        session.invalidate(errorMessage: "This doesn't look like a Bali tag.")
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        let code = (error as? NFCReaderError)?.code
        if code == .readerSessionInvalidationErrorUserCanceled {
            resume(throwing: ScanError.cancelled)
        } else if code == .readerSessionInvalidationErrorFirstNDEFTagRead {
            // normal end after a successful read; continuation already resumed
            resume(throwing: ScanError.cancelled)
        } else {
            resume(throwing: ScanError.failed(error.localizedDescription))
        }
        self.session = nil
    }

    private func finish(_ session: NFCNDEFReaderSession, code: String) {
        session.alertMessage = "Tag read."
        session.invalidate()
        resume(returning: code)
    }

    private func resume(returning value: String) {
        continuation?.resume(returning: value)
        continuation = nil
    }

    private func resume(throwing error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
/// T4's write flow: puts the server-issued code onto a physical NDEF tag as a
/// well-known text record (the student reader and QR both resolve the same code).
final class TagCodeWriter: NSObject, NFCNDEFReaderSessionDelegate, @unchecked Sendable {
    static var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    private var session: NFCNDEFReaderSession?
    private var continuation: CheckedContinuation<Void, Error>?
    private var code = ""

    enum WriteError: LocalizedError {
        case cancelled
        case notWritable
        case failed(String)
        var errorDescription: String? {
            switch self {
            case .cancelled: return nil
            case .notWritable: return "This tag can't be written — try a blank NDEF sticker."
            case .failed(let message): return message
            }
        }
    }

    func write(code: String) async throws {
        self.code = code
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
            session.alertMessage = "Hold your iPhone near the tag to write it."
            self.session = session
            session.begin()
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        // unused — tag delegate below handles writing
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        session.connect(to: tag) { [weak self] error in
            guard let self else { return }
            if let error {
                session.invalidate(errorMessage: error.localizedDescription)
                self.resume(throwing: WriteError.failed(error.localizedDescription))
                return
            }
            tag.queryNDEFStatus { status, _, _ in
                guard status == .readWrite else {
                    session.invalidate(errorMessage: "This tag isn't writable.")
                    self.resume(throwing: WriteError.notWritable)
                    return
                }
                guard let payload = NFCNDEFPayload.wellKnownTypeTextPayload(string: self.code, locale: Locale(identifier: "en")) else {
                    session.invalidate(errorMessage: "Couldn't build the tag payload.")
                    self.resume(throwing: WriteError.failed("Couldn't build the tag payload."))
                    return
                }
                tag.writeNDEF(NFCNDEFMessage(records: [payload])) { writeError in
                    if let writeError {
                        session.invalidate(errorMessage: writeError.localizedDescription)
                        self.resume(throwing: WriteError.failed(writeError.localizedDescription))
                    } else {
                        session.alertMessage = "Tag written."
                        session.invalidate()
                        self.resume()
                    }
                }
            }
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        if (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled {
            resume(throwing: WriteError.cancelled)
        } else {
            resume(throwing: WriteError.failed(error.localizedDescription))
        }
        self.session = nil
    }

    private func resume(throwing error: Error? = nil) {
        if let error {
            continuation?.resume(throwing: error)
        } else {
            continuation?.resume(returning: ())
        }
        continuation = nil
    }
}
#endif

/// `bali://t/<code>` — W2's "Open in Bali" lands here.
@MainActor
final class DeepLinks: ObservableObject {
    @Published var pendingTagCode: String?

    func handle(_ url: URL) {
        guard url.scheme?.lowercased() == "bali" else { return }
        pendingTagCode = NFCTagRead.extractCode(fromURL: url)
    }
}
