//
//  RoleGate.swift
//  Bali — auth
//
//  After authentication, decide whether the signed-in user may use the student
//  app. Mirrors Android: probe `GET /students/me`, which returns 200 for a
//  student with a profile, 404 for a student who hasn't created one yet, and 403
//  for non-students. The server enforces this too; the gate just routes the UI.
//

import Foundation

enum RoleGateResult: Equatable {
    case student(hasProfile: Bool)
    case notAStudent
    case failed(String)
}

protocol RoleGate: Sendable {
    func resolve() async -> RoleGateResult
}

/// Real gate: probes the student endpoint and maps status codes.
struct LiveRoleGate: RoleGate {
    let api: any APIClient

    func resolve() async -> RoleGateResult {
        do {
            let status = try await api.probeStatus("GET", "students/me")
            switch status {
            case 200: return .student(hasProfile: true)
            case 404: return .student(hasProfile: false)
            case 403: return .notAStudent
            default:  return .failed("We couldn't load your account. Try again.")
            }
        } catch let error as APIError {
            if case .unauthorized = error { return .failed(error.userMessage) }
            return .failed(error.userMessage)
        } catch {
            return .failed("We couldn't load your account. Try again.")
        }
    }
}

/// Stub gate for Simulator/dev without a backend. Defaults to an enrolled
/// student so the post-login app shell is reachable.
struct StubRoleGate: RoleGate {
    var result: RoleGateResult = .student(hasProfile: true)
    func resolve() async -> RoleGateResult {
        #if DEBUG
        // Verification aid: `-baliOnboarding YES` routes to the onboarding flow.
        if UserDefaults.standard.bool(forKey: "baliOnboarding") {
            return .student(hasProfile: false)
        }
        #endif
        return result
    }
}
