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
    let nfcReader: any NFCReader
    let checkInService: CheckInService
    let screenTimeService: any ScreenTimeService
    let focusController: FocusModeController

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

        #if !targetEnvironment(simulator) && canImport(CoreNFC)
        nfcReader = CoreNFCReader()
        #else
        nfcReader = UnavailableNFCReader()
        #endif
        checkInService = CheckInService(api: apiClient)

        #if !targetEnvironment(simulator) && canImport(FamilyControls)
        screenTimeService = RealScreenTimeService()
        #else
        screenTimeService = StubScreenTimeService()
        #endif

        self.auth = AuthStore(auth: authService, gate: gate)
        self.router = AppRouter()
        let model = AppModel(repo: repo)
        self.model = model
        self.focusController = FocusModeController(service: screenTimeService, model: model)
    }

    /// Test/preview seam: inject specific collaborators.
    init(apiClient: any APIClient, auth: AuthStore, model: AppModel, router: AppRouter? = nil) {
        self.apiClient = apiClient
        self.auth = auth
        self.model = model
        self.router = router ?? AppRouter()
        self.nfcReader = UnavailableNFCReader()
        self.checkInService = CheckInService(api: apiClient)
        let sts = StubScreenTimeService()
        self.screenTimeService = sts
        self.focusController = FocusModeController(service: sts, model: model)
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
            .environment(env.focusController)
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
