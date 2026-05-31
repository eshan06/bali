//
//  AppEnvironment.swift
//  Bali
//
//  Composition root. Builds the observable stores once and injects them into
//  the view tree via `.environment`. As later phases add services (APIClient,
//  CognitoService, NFCReader, ScreenTimeService), they're constructed here and
//  handed to the stores that need them — views never build their own.
//

import SwiftUI

@MainActor
@Observable
final class AppEnvironment {
    let auth: AuthStore
    let router: AppRouter

    // Params are optional (not `= AuthStore()`) because default-argument
    // expressions are evaluated in a nonisolated context and can't call these
    // @MainActor initializers; the `??` fallbacks run inside this MainActor init.
    init(auth: AuthStore? = nil, router: AppRouter? = nil) {
        self.auth = auth ?? AuthStore()
        self.router = router ?? AppRouter()
    }
}

extension View {
    /// Inject the whole environment graph (each store individually so views can
    /// `@Environment(AuthStore.self)` etc.).
    func injectBaliEnvironment(_ env: AppEnvironment) -> some View {
        self
            .environment(env)
            .environment(env.auth)
            .environment(env.router)
    }
}
