//
//  ScreenTimeService.swift
//  Bali — services/focus
//
//  The Screen Time blocking seam. `RealScreenTimeService` (device) drives
//  FamilyControls authorization + ManagedSettings shields; `StubScreenTimeService`
//  (Simulator / no entitlement) mocks "approved" + no-op shielding so the Focus
//  Mode UI + countdown demo without the Family Controls entitlement (§9.12).
//

import Foundation

nonisolated enum FocusAuthorization: Equatable {
    case notDetermined, approved, denied
}

protocol ScreenTimeService: Sendable {
    /// False on the Simulator / without the entitlement — real shielding can't run.
    var isAvailable: Bool { get }
    /// How many apps/categories the student has chosen to shield (0 if none /
    /// unsupported). Drives the Settings badge; `applyShields` no-ops at 0.
    var blockedSelectionCount: Int { get }
    func authorizationStatus() async -> FocusAuthorization
    func requestAuthorization() async -> FocusAuthorization
    /// Apply shields for the session policy. Returns whether shielding took effect.
    @discardableResult
    func applyShields(for snapshot: BlockingSnapshot) async -> Bool
    func clearShields() async
}

/// Simulator / no-entitlement stub — mocks success so the UI demos; never claims
/// to actually shield anything.
nonisolated struct StubScreenTimeService: ScreenTimeService {
    var isAvailable: Bool { false }
    var blockedSelectionCount: Int { 0 }
    func authorizationStatus() async -> FocusAuthorization { .approved }
    func requestAuthorization() async -> FocusAuthorization { .approved }
    func applyShields(for snapshot: BlockingSnapshot) async -> Bool { true }
    func clearShields() async {}
}
