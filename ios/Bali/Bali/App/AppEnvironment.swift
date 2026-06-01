//
//  AppEnvironment.swift
//  Bali
//
//  Composition root. Builds the services and observable stores once and injects
//  them into the view tree. The implementation is chosen at compile time: the
//  real Amplify auth + live repository when the Amplify package is present,
//  otherwise the Simulator stub auth + sample data — nothing above this file
//  changes either way.
//

import SwiftUI

@MainActor
@Observable
final class AppEnvironment {
    let apiClient: any APIClient
    let auth: AuthStore
    let router: AppRouter
    let model: AppModel

    init() {
        let authService: AuthService
        let gate: RoleGate
        let repo: StudentRepository

        #if canImport(Amplify)
        let amplify = AmplifyAuthService()
        authService = amplify
        let client = LiveAPIClient(config: .current, tokenProvider: { await amplify.currentJWT() })
        apiClient = client
        gate = LiveRoleGate(api: client)
        repo = LiveStudentRepository(api: client)
        #else
        let stub = StubAuthService()
        authService = stub
        apiClient = LiveAPIClient(config: .current, tokenProvider: { await stub.currentJWT() })
        gate = StubRoleGate()
        repo = SampleStudentRepository()
        #endif

        self.auth = AuthStore(auth: authService, gate: gate)
        self.router = AppRouter()
        self.model = AppModel(repo: repo)
    }

    /// Test/preview seam: inject specific collaborators.
    init(apiClient: any APIClient, auth: AuthStore, model: AppModel, router: AppRouter? = nil) {
        self.apiClient = apiClient
        self.auth = auth
        self.model = model
        self.router = router ?? AppRouter()
    }
}

extension View {
    /// Inject the environment graph (each store individually so views can use
    /// `@Environment(AuthStore.self)` / `@Environment(AppRouter.self)` /
    /// `@Environment(AppModel.self)`).
    func injectBaliEnvironment(_ env: AppEnvironment) -> some View {
        self
            .environment(env)
            .environment(env.auth)
            .environment(env.router)
            .environment(env.model)
    }
}

#if DEBUG
extension AppEnvironment {
    /// A ready-to-use environment for previews (stub auth + loaded sample data).
    static func preview(phase: AppPhase = .app) -> AppEnvironment {
        let stub = StubAuthService()
        let api = LiveAPIClient(config: .current, tokenProvider: { await stub.currentJWT() })
        let store = AuthStore(auth: stub, gate: StubRoleGate())
        return AppEnvironment(apiClient: api, auth: store, model: .preview)
    }
}
#endif
