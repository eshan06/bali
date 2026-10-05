import Foundation
import Testing

@testable import BaliCore

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

// C4: the sign-in deleting itself — the scope Cognito's DeleteUser needs, the call at the pool's own
// endpoint, and no token for the API once the API has deleted the account.

let deleteUserEndpoint = "https://cognito-idp.us-east-1.amazonaws.com/"

/// An access token from a sign-in that asked for the scope DeleteUser needs, as Cognito's reads on
/// the phone: `scope` and its pool's `iss` beside `iat` and `exp` — or another issuer's.
func admin(
    _ name: String, lifetime: TimeInterval = 3600,
    issuer: String = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT"
) -> String {
    let iat = 1_000_000_000
    let payload =
        #"{"sub":"\#(name)","iat":\#(iat),"exp":\#(iat + Int(lifetime)),"scope":"openid email profile aws.cognito.signin.user.admin","iss":"\#(issuer)"}"#
    return "eyJhbGciOiJSUzI1NiJ9.\(base64url(Data(payload.utf8))).signature"
}

/// Cognito's JSON-protocol error, its type as Cognito names it.
func cognitoError(_ type: String) -> String { #"{"__type":"\#(type)","message":"no"}"# }

/// Answers the token endpoint from `tokens` and DeleteUser from `deletes`, each nil for no answer.
func cognitoDouble(tokens: Answers, deletes: Answers) -> TransportDouble {
    TransportDouble { request in
        let answers = request.url?.absoluteString == deleteUserEndpoint ? deletes : tokens
        let (status, body) = try answers.next()
        return (status, Data(body.utf8))
    }
}

/// The access tokens each DeleteUser call `endpoint` was sent carried.
func deletesSent(_ endpoint: TransportDouble) async throws -> [String] {
    try await endpoint.sent.filter { $0.url?.absoluteString == deleteUserEndpoint }.map {
        try JSONDecoder().decode([String: String].self, from: try #require($0.httpBody))["AccessToken"]
            ?? ""
    }
}

@Suite("The sign-in deleting itself (C4)", .timeLimit(.minutes(3)))
struct DeleteUserTests {
    @Test(
        "a token carrying the scope DeleteUser needs, from a Cognito pool, may delete itself; one from a sign-in before the phone asked for it, one naming another issuer — another host under amazonaws.com too — and none at all may not — a fresh sign-in first"
    )
    func mayDelete() async throws {
        let endpoint = TransportDouble(status: 500)
        #expect(await signIn(try .holding(admin("a1")), endpoint, told: Told()).mayDelete())
        #expect(await !signIn(try .holding(jwt("a1")), endpoint, told: Told()).mayDelete())
        for issuer in [
            "https://cognito-idp.us-east-1.example.com/us-east-1_x",
            "https://cognito-idp.bucket.s3.amazonaws.com/us-east-1_x",
            "https://cognito-idp.s3.amazonaws.com/us-east-1_x",  // a bucket named cognito-idp
        ] {
            let phone = await signIn(try .holding(admin("a1", issuer: issuer)), endpoint, told: Told())
            #expect(await !phone.mayDelete(), "\(issuer)")
        }
        #expect(await !signIn(MemoryStore(), endpoint, told: Told()).mayDelete())
        #expect(await endpoint.sent.isEmpty)
    }

    @Test(
        "DeleteUser takes the access token alone, in Cognito's JSON protocol at its pool's own endpoint — no Authorization header, no AWS credential; deleted, the tokens are forgotten as a sign-out forgets them"
    )
    func deleted() async throws {
        let endpoint = TransportDouble(status: 200, body: "{}")
        let store = try MemoryStore.holding(admin("a1"))
        let phone = await signIn(store, endpoint, told: Told())
        let watching = await phone.signedIn()

        #expect(await phone.deleteUser() == nil)
        let sent = try #require(await endpoint.sent.first)
        #expect(await endpoint.sent.count == 1)
        #expect(sent.httpMethod == "POST" && sent.url?.absoluteString == deleteUserEndpoint)
        #expect(
            sent.value(forHTTPHeaderField: "X-Amz-Target")
                == "AWSCognitoIdentityProviderService.DeleteUser")
        #expect(sent.value(forHTTPHeaderField: "Content-Type") == "application/x-amz-json-1.1")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(sent.timeoutInterval == APIClient.requestTimeout)
        #expect(try await deletesSent(endpoint) == [admin("a1")])
        #expect(store.data == nil)
        #expect(await first(watching) == false)
        #expect(await phone.accessToken() == nil)
    }

    @Test(
        "a DeleteUser that does not finish keeps the tokens to try again, and says what Cognito answered: no answer, a server error, throttling, another refusal",
        arguments: [
            nil, (500, cognitoError("InternalErrorException")),
            (400, cognitoError("TooManyRequestsException")), (400, cognitoError("InvalidParameterException")),
        ] as [(Int, String)?])
    func kept(reply: (Int, String)?) async throws {
        let deletes = Answers(reply)
        let endpoint = cognitoDouble(tokens: Answers(nil), deletes: deletes)
        let store = try MemoryStore.holding(admin("a1"))
        let phone = await signIn(store, endpoint, told: Told())

        #expect(await phone.deleteUser() == (reply.map { .status($0.0) } ?? .networkError))
        #expect(store.tokens?.access == admin("a1"))
        #expect(await first(phone.signedIn()) == true)
        deletes.set((200, "{}"))
        #expect(await phone.deleteUser() == nil)
        #expect(store.data == nil)
        #expect(try await deletesSent(endpoint) == [admin("a1"), admin("a1")])
    }

    @Test(
        "a user Cognito no longer has is deleted already; a token it no longer takes is renewed once and DeleteUser made again — a sign-in it then refuses for good (deleted by a try whose answer never came) is gone and forgotten, one it still cannot renew kept, and a second no said"
    )
    func goneAlready() async throws {
        // Its type read past any namespace, as Cognito's JSON protocol allows.
        let type = "com.amazonaws.cognito.identity.idp.model#UserNotFoundException"
        let notFound = cognitoDouble(tokens: Answers(nil), deletes: Answers((400, cognitoError(type))))
        let store = try MemoryStore.holding(admin("a1"))
        #expect(await signIn(store, notFound, told: Told()).deleteUser() == nil)
        #expect(store.data == nil)

        let (tokens, deletes) = (
            Answers((200, granted(admin("a2")))),
            Answers((400, cognitoError("NotAuthorizedException")))
        )
        let endpoint = cognitoDouble(tokens: tokens, deletes: deletes)
        let renewed = try MemoryStore.holding(admin("a1"))
        let phone = await signIn(renewed, endpoint, told: Told())
        #expect(await phone.deleteUser() == .status(400))  // refused again, renewed: said
        #expect(try await deletesSent(endpoint) == [admin("a1"), admin("a2")])
        #expect(renewed.tokens?.access == admin("a2"))

        tokens.set(nil)  // Cognito out of reach: kept to try again
        #expect(await phone.deleteUser() == .networkError)
        #expect(renewed.tokens?.access == admin("a2"))

        tokens.set((400, refusal("invalid_grant")))  // the sign-in itself is gone
        #expect(await phone.deleteUser() == nil)
        #expect(renewed.data == nil)
        #expect(await first(phone.signedIn()) == false)
    }

    @Test("an expired token is renewed before DeleteUser takes it, as one given to the API is")
    func expired() async throws {
        let endpoint = cognitoDouble(
            tokens: Answers((200, granted(admin("a2")))), deletes: Answers((200, "{}")))
        let now = Now()
        let phone = await signIn(try .holding(admin("a1")), endpoint, now: now, told: Told())
        now.set(4000)
        #expect(await phone.deleteUser() == nil)
        #expect(try await deletesSent(endpoint) == [admin("a2")])
    }

    @Test(
        "once the API has deleted the account, no token goes to the API — through a renewal and a relaunch too, and a Keychain that could not take it then takes it at the next ask — while DeleteUser still takes one; a sign-out forgets it with the tokens"
    )
    func pending() async throws {
        let deletes = Answers((500, "{}"))
        let endpoint = cognitoDouble(tokens: Answers((200, granted(admin("a2")))), deletes: deletes)
        let store = try MemoryStore.holding(admin("a1"))
        let phone = await signIn(store, endpoint, told: Told())
        #expect(await !phone.deletionPending())

        #expect(await phone.accessToken() == admin("a1"))  // read while the phone is unlocked
        store.setLocked(true)
        await phone.accountDeleted()
        #expect(await phone.accessToken() == nil)
        #expect(store.tokens?.deleted == nil)  // locked: not taken yet
        store.setLocked(false)
        #expect(await phone.deletionPending())
        #expect(store.tokens?.deleted == true)

        #expect(await phone.refresh())
        #expect(store.tokens?.access == admin("a2") && store.tokens?.deleted == true)
        #expect(await phone.accessToken() == nil)

        let relaunched = await signIn(store, endpoint, told: Told())
        #expect(await relaunched.deletionPending())
        #expect(await relaunched.accessToken() == nil)
        #expect(await first(relaunched.signedIn()) == true)
        #expect(await relaunched.deleteUser() == .status(500))
        #expect(try await deletesSent(endpoint) == [admin("a2")])

        try await relaunched.signOut()
        #expect(await !relaunched.deletionPending())
        #expect(store.data == nil)
    }
}
