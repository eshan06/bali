//
//  CheckInService.swift
//  Bali — services/NFC
//
//  The check-in seam. Today it drives the existing student endpoint
//  `POST /students/me/classes/{id}/simulate-check-in` from a REAL Core NFC read
//  (there is no "simulate" affordance in the UI). When a tag-aware
//  `POST /students/me/check-in` (or /nfc-check-in) ships — a backend change,
//  §9.2 — only this method changes; nothing above the seam moves.
//

import Foundation

nonisolated struct CheckInService {
    let api: any APIClient

    func checkIn(classId: String, tag: NFCTagPayload) async -> CheckInOutcome {
        do {
            let response = try await api.post(
                "students/me/classes/\(classId)/simulate-check-in",
                body: nil, as: CheckInResponse.self)
            return .success(response)
        } catch APIError.http(let status, let message) {
            switch status {
            case 409: return .noSession   // "No active session for this class right now."
            default:  return .failed(message ?? "Check-in didn't go through. Try again.")
            }
        } catch let error as APIError {
            return .failed(error.userMessage)
        } catch {
            return .failed("Check-in didn't go through. Try again.")
        }
    }
}
