//
//  AppEnvironment.swift
//  Bali
//
//  Composition root. Builds the services and observable stores once and injects
//  them into the view tree. The auth implementation is chosen at compile time:
//  the real AmplifyAuthService when the Amplify package is present, otherwise the
//  Simulator stub — nothing above this file changes either way.
//
//  NOTE (Phase 4): the StudentRepository + AppModel data layer plugs in here —
//  see ios/PLAN.md "Resume here". Keep the same compile-time stub/live split.
//

import SwiftUI

@MainActor
@Observable
final class AppEnvironment {
    let apiClient: any APIClient
    let auth: AuthStore
    let router: AppRouter

    init() {
        let authService: AuthService
        let gate: RoleGate

        #if canImport(Amplify)
        let amplify = AmplifyAuthService()
        authService = amplify
        let client = LiveAPIClient(config: .current, tokenProvider: { await amplify.currentJWT() })
        apiClient = client
        gate = LiveRoleGate(api: client)
        #else
        let stub = StubAuthService()
        authService = stub
        apiClient = LiveAPIClient(config: .current, tokenProvider: { await stub.currentJWT() })
        gate = StubRoleGate()
        #endif

        self.auth = AuthStore(auth: authService, gate: gate)
        self.router = AppRouter()
    }

    /// Test/preview seam: inject specific collaborators.
    init(apiClient: any APIClient, auth: AuthStore, router: AppRouter? = nil) {
        self.apiClient = apiClient
        self.auth = auth
        self.router = router ?? AppRouter()
    }
}

extension View {
    /// Inject the environment graph (each store individually so views can use
    /// `@Environment(AuthStore.self)` / `@Environment(AppRouter.self)`).
    func injectBaliEnvironment(_ env: AppEnvironment) -> some View {
        self
            .environment(env)
            .environment(env.auth)
            .environment(env.router)
    }
}

#if DEBUG
extension AppEnvironment {
    /// A ready-to-use environment for previews (stub auth).
    static func preview(phase: AppPhase = .app) -> AppEnvironment {
        let stub = StubAuthService()
        let api = LiveAPIClient(config: .current, tokenProvider: { await stub.currentJWT() })
        let store = AuthStore(auth: stub, gate: StubRoleGate())
        return AppEnvironment(apiClient: api, auth: store)
    }
}
#endif
