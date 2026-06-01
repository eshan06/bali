//
//  NFCCheckInController.swift
//  Bali — state
//
//  Drives the NFC check-in sheet: opens a real Core NFC read, calls CheckInService,
//  and maps the result to a phase the sheet renders. On the Simulator (no NFC) it
//  resolves to `.unavailable` — never a fake check-in. On success it records the
//  check-in in AppModel so the dashboard updates immediately.
//

import SwiftUI

@MainActor
@Observable
final class NFCCheckInController {
    enum Phase: Equatable {
        case unavailable        // Simulator / no NFC radio
        case waiting            // session open, waiting for the tag (radar)
        case reading            // tag detected, checking in
        case result(CheckInOutcome)
    }

    private(set) var phase: Phase = .waiting
    private(set) var targetClassId: String?

    private let reader: any NFCReader
    private let service: CheckInService
    private let model: AppModel

    init(reader: any NFCReader, service: CheckInService, model: AppModel) {
        self.reader = reader
        self.service = service
        self.model = model
    }

    func begin(classId: String?) async {
        targetClassId = classId ?? model.liveClass?.id

        #if DEBUG
        if let forced = forcedPhase() { phase = forced; return }
        #endif

        guard reader.isAvailable else { phase = .unavailable; return }
        guard let target = targetClassId else { phase = .result(.noSession); return }
        guard DeviceIdentity.isRegistered else { phase = .result(.notAssigned); return }

        phase = .waiting
        do {
            let tag = try await reader.scan(prompt: "Hold the top of your iPhone near your Bali block.")
            phase = .reading
            let outcome = await service.checkIn(classId: target, tag: tag)
            if case .success(let response) = outcome {
                model.markCheckedIn(sessionId: response.sessionId)
            }
            phase = .result(outcome)
        } catch NFCReadError.cancelled {
            phase = .result(.cancelled)
        } catch {
            phase = .result(.failed("Couldn't read the block. Move your iPhone closer and try again."))
        }
    }

    func retry() async { await begin(classId: targetClassId) }

    #if DEBUG
    /// Verification aid: `-baliNfcState <waiting|reading|notAssigned|noSession|failed|
    /// success|unavailable>` forces a phase so each sheet state is screenshottable
    /// on the Simulator (which can't perform a real scan).
    private func forcedPhase() -> Phase? {
        switch UserDefaults.standard.string(forKey: "baliNfcState") {
        case "waiting":     return .waiting
        case "reading":     return .reading
        case "notAssigned": return .result(.notAssigned)
        case "noSession":   return .result(.noSession)
        case "failed":      return .result(.failed("Couldn't read the block. Try again."))
        case "success":
            return .result(.success(CheckInResponse(
                success: true, sessionId: "ses-bio", classId: targetClassId ?? "cls-bio",
                attendanceStatus: .present, checkInTime: SampleStudentRepository.iso(Date()),
                blockingPolicy: SampleStudentRepository.fullFocus)))
        case "unavailable": return .unavailable
        default:            return nil
        }
    }
    #endif
}
