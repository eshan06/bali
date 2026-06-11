//
//  CoreNFCReader.swift
//  Bali — services/NFC
//
//  Device-only Core NFC reader (excluded from the Simulator build, which has no
//  NFC radio). Opens an NFCTagReaderSession and returns the first tag's UID; the
//  tag is the trigger, the UID isn't required by the current endpoint. Bridges
//  the delegate callbacks to async/await.
//
//  Requires (device): the "Near Field Communication Tag Reading" capability +
//  `com.apple.developer.nfc.readersession.formats` entitlement + an
//  `NFCReaderUsageDescription` Info.plist string (PLAN.md §9.12). Not needed to
//  build/run on the Simulator.
//

#if !targetEnvironment(simulator) && canImport(CoreNFC)
@preconcurrency import CoreNFC
import Foundation

nonisolated final class CoreNFCReader: NSObject, NFCReader, NFCTagReaderSessionDelegate, @unchecked Sendable {
    var isAvailable: Bool { NFCTagReaderSession.readingAvailable }

    private var session: NFCTagReaderSession?
    private var continuation: CheckedContinuation<NFCTagPayload, Error>?

    func scan(prompt: String) async throws -> NFCTagPayload {
        guard NFCTagReaderSession.readingAvailable else { throw NFCReadError.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let session = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693],
                                              delegate: self, queue: nil)
            session?.alertMessage = prompt
            self.session = session
            session?.begin()
        }
    }

    // MARK: NFCTagReaderSessionDelegate

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        if (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled {
            resume(throwing: NFCReadError.cancelled)
        } else {
            resume(throwing: NFCReadError.readFailed(error.localizedDescription))
        }
        self.session = nil
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let tag = tags.first else {
            session.invalidate(errorMessage: "No tag found.")
            return
        }
        // CoreNFC serializes its delegate/completion callbacks on its own queue, so
        // these non-Sendable values never actually cross isolation boundaries
        // concurrently. `connect`'s completion handler is `@Sendable`, so assert that.
        nonisolated(unsafe) let nfcSession = session
        nonisolated(unsafe) let nfcTag = tag
        session.connect(to: tag) { [weak self] error in
            if let error {
                nfcSession.invalidate(errorMessage: error.localizedDescription)
                self?.resume(throwing: NFCReadError.readFailed(error.localizedDescription))
                return
            }
            nfcSession.alertMessage = "Checked the block."
            nfcSession.invalidate()
            self?.resume(returning: NFCTagPayload(identifier: Self.identifier(of: nfcTag), message: nil))
        }
    }

    // MARK: Helpers

    private func resume(returning value: NFCTagPayload) {
        continuation?.resume(returning: value)
        continuation = nil
    }

    private func resume(throwing error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    private static func identifier(of tag: NFCTag) -> String {
        let data: Data
        switch tag {
        case .miFare(let t):   data = t.identifier
        case .iso7816(let t):  data = t.identifier
        case .iso15693(let t): data = t.identifier
        case .feliCa(let t):   data = t.currentIDm
        @unknown default:      data = Data()
        }
        return data.map { String(format: "%02X", $0) }.joined()
    }
}
#endif
