//
//  NFCReader.swift
//  Bali — services/NFC
//
//  The check-in NFC seam. `CoreNFCReader` (device) reads the passive Bali tag;
//  `UnavailableNFCReader` (Simulator / no-NFC) never fakes a read — the sheet
//  shows an honest "needs a physical iPhone" state. The read is a real Core NFC
//  scan; check-in is never a "simulate" affordance in the UI.
//

import Foundation

/// A tag read result. The current `simulate-check-in` endpoint doesn't consume
/// the payload (the JWT + classId identify the student); a future tag-aware
/// endpoint (§9.2) would resolve tag → device → student → session from it.
nonisolated struct NFCTagPayload: Sendable, Equatable {
    let identifier: String      // tag UID (hex), or NDEF id
    let message: String?        // NDEF text payload, if any
}

nonisolated enum NFCReadError: Error {
    case unavailable
    case cancelled
    case readFailed(String)
}

/// Reads the passive Bali NFC tag. Device Core NFC, or an unavailable stub on the
/// Simulator (no NFC radio).
protocol NFCReader: Sendable {
    var isAvailable: Bool { get }
    func scan(prompt: String) async throws -> NFCTagPayload
}

/// Simulator / no-NFC stub — never fakes a read.
nonisolated struct UnavailableNFCReader: NFCReader {
    var isAvailable: Bool { false }
    func scan(prompt: String) async throws -> NFCTagPayload {
        throw NFCReadError.unavailable
    }
}

/// What the check-in sheet maps to a result state.
nonisolated enum CheckInOutcome: Equatable {
    case success(CheckInResponse)
    case notAssigned   // this device isn't linked to the student's seat (screen 09)
    case noSession     // no active session to check into
    case failed(String)
    case cancelled
}
