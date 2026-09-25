import BaliCore
import Foundation

#if canImport(CoreNFC)
    @preconcurrency import CoreNFC

    /// The phone's NFC reader, reading a Bali block (B6) as v2 did: an NDEF reader session, iOS's
    /// own sheet, one tag a scan. Thin on purpose: what a tag holds is `BlockTag`'s to say, and
    /// what a read records is `SyncEngine.tap(_:)`'s, both tested on Linux.
    final class BlockReader: NSObject, NFCNDEFReaderSessionDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var session: NFCNDEFReaderSession?
        private var answer: CheckedContinuation<BlockRead, Never>?

        /// One scan: until a tag is read, the student cancels, or iOS gives up (a minute).
        func read() async -> BlockRead {
            guard NFCNDEFReaderSession.readingAvailable else { return .unsupported }
            return await withCheckedContinuation { answer in
                let session = NFCNDEFReaderSession(
                    delegate: self, queue: nil, invalidateAfterFirstRead: true)
                session.alertMessage = "Hold the top of your iPhone to your teacher's Bali block."
                lock.withLock { (self.session, self.answer) = (session, answer) }
                session.begin()
            }
        }

        func readerSession(
            _ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]
        ) {
            let records = messages.flatMap(\.records).map {
                BlockTag.Record(
                    format: $0.typeNameFormat.rawValue, type: $0.type, payload: $0.payload)
            }
            guard let code = BlockTag.code(in: records) else {
                session.invalidate(errorMessage: "This isn't a Bali block.")
                return finish(.notBali)
            }
            session.alertMessage = "Bali block read."
            session.invalidate()
            finish(.block(code))
        }

        /// How the scan ended. After a read, iOS ends it too — answered already, which this leaves.
        func readerSession(
            _ session: NFCNDEFReaderSession, didInvalidateWithError error: any Error
        ) {
            let read: BlockRead =
                switch (error as? NFCReaderError)?.code {
                case .readerSessionInvalidationErrorUserCanceled?: .cancelled
                // A tag with nothing on it: not a Bali block.
                case .ndefReaderSessionErrorZeroLengthMessage?: .notBali
                case .readerErrorUnsupportedFeature?: .unsupported
                default: .failed(error.localizedDescription)
                }
            finish(read)
        }

        /// The scan's answer: the first only.
        private func finish(_ read: BlockRead) {
            let answer = lock.withLock {
                defer { (self.session, self.answer) = (nil, nil) }
                return self.answer
            }
            answer?.resume(returning: read)
        }
    }
#else
    /// No NFC on this platform: every scan finds a phone that cannot read.
    final class BlockReader: Sendable {
        func read() async -> BlockRead { .unsupported }
    }
#endif
