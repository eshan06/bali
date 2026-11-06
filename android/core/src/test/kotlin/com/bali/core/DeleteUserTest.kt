package com.bali.core

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Dns
import okhttp3.Headers.Companion.headersOf

// C4: the sign-in deleting itself, DeleteUserTests.swift whole: the scope Cognito's DeleteUser needs, the call
// at the pool's own endpoint, and no token for the API once the API has deleted the account. And new: the
// call on the wire over OkHttp, and only the sign-in it began with deleted (Q4).

/** Where [admin]'s token deletes itself: its pool's own endpoint. */
const val DELETE_USER_ENDPOINT = "https://cognito-idp.us-east-1.amazonaws.com/"

/** Cognito's JSON-protocol error, its type as Cognito names it. */
fun cognitoError(type: String) = """{"__type":"$type","message":"no"}"""

/** Cognito answering its token endpoint through [tokens] and DeleteUser through [deletes]. */
fun cognitoDouble(tokens: HttpTransport, deletes: HttpTransport) =
    TransportDouble { request -> (if (request.url.toString() == DELETE_USER_ENDPOINT) deletes else tokens).send(request) }

/** The access tokens each DeleteUser call [endpoint] was sent carried. */
fun deletesSent(endpoint: TransportDouble): List<String> =
    endpoint.sent.filter { it.url.toString() == DELETE_USER_ENDPOINT }.map { accessToken(it.body) }

/** The token a DeleteUser [body] carries, its one field. */
fun accessToken(body: ByteArray?): String {
    val fields = BaliJson.parseToJsonElement(assertNotNull(body).decodeToString()).jsonObject
    assertEquals(setOf("AccessToken"), fields.keys)
    return fields.getValue("AccessToken").jsonPrimitive.content
}

/** The sign-in deleting itself (C4). */
class DeleteUserTest : SignIns() {
    @Test
    fun aTokenCarryingTheScopeDeleteUserNeedsFromACognitoPoolMayDeleteItselfOneFromBeforeTheScopeAnotherIssuersOrNoneMayNot() =
        inTime {
            // A fresh sign-in first, for a token from before the phone asked for the scope.
            val endpoint = TransportDouble.answering(500)
            assertTrue(signIn(MemoryStore.holding(admin("a1")), endpoint).mayDelete())
            assertFalse(signIn(MemoryStore.holding(jwt("a1")), endpoint).mayDelete())
            for (issuer in listOf(
                "https://cognito-idp.us-east-1.example.com/us-east-1_x",
                "https://cognito-idp.bucket.s3.amazonaws.com/us-east-1_x",
                "https://cognito-idp.s3.amazonaws.com/us-east-1_x", // a bucket named cognito-idp
            )) {
                assertFalse(signIn(MemoryStore.holding(admin("a1", issuer)), endpoint).mayDelete(), issuer)
            }
            assertFalse(signIn(MemoryStore(), endpoint).mayDelete())
            assertTrue(endpoint.sent.isEmpty())
        }

    @Test
    fun deleteUserTakesTheAccessTokenAloneInCognitosJsonProtocolAtItsPoolsOwnEndpointNoAuthorizationAndDeletedTheTokensAreForgottenAsASignOutForgetsThem() =
        inTime {
            val endpoint = TransportDouble.answering(200, "{}")
            val store = MemoryStore.holding(admin("a1"))
            val phone = signIn(store, endpoint)
            assertNull(phone.deleteUser())
            val sent = endpoint.sent.single()
            assertEquals(listOf("POST", DELETE_USER_ENDPOINT), listOf(sent.method, sent.url.toString()))
            // Cognito's two headers alone: no Authorization header, no AWS credential.
            assertEquals(
                mapOf("Content-Type" to "application/x-amz-json-1.1", "X-Amz-Target" to "AWSCognitoIdentityProviderService.DeleteUser"),
                sent.headers,
            )
            assertEquals(ApiClient.REQUEST_TIMEOUT, sent.timeout)
            assertEquals(listOf(admin("a1")), deletesSent(endpoint))
            assertNull(store.data)
            assertFalse(phone.signedIn().first())
            assertNull(phone.accessToken())
        }

    @Test
    fun aDeleteUserThatDoesntFinishKeepsTheTokensToTryAgainAndSaysWhatCognitoAnsweredNoAnswerAServerErrorThrottlingAnotherRefusal() =
        inTime {
            for (reply in listOf(
                null, 500 to cognitoError("InternalErrorException"),
                400 to cognitoError("TooManyRequestsException"), 400 to cognitoError("InvalidParameterException"),
            )) {
                val deletes = Answers(reply)
                val endpoint = cognitoDouble(tokens = Answers(null).endpoint(), deletes = deletes.endpoint())
                val store = MemoryStore.holding(admin("a1"))
                val phone = signIn(store, endpoint)
                assertEquals(reply?.let { SendResult.Status(it.first) } ?: SendResult.NetworkError, phone.deleteUser(), "$reply")
                assertEquals(admin("a1"), store.tokens?.access, "$reply")
                assertTrue(phone.signedIn().first(), "$reply")
                deletes.set(200 to "{}")
                assertNull(phone.deleteUser(), "$reply")
                assertNull(store.data, "$reply")
                assertEquals(listOf(admin("a1"), admin("a1")), deletesSent(endpoint), "$reply")
            }
            // A transport throwing what none should is no answer too, never a throw.
            val store = MemoryStore.holding(admin("a1"))
            assertEquals(SendResult.NetworkError, signIn(store, TransportDouble { throw IllegalStateException("odd") }).deleteUser())
            assertEquals(admin("a1"), store.tokens?.access)
        }

    @Test
    fun aUserCognitoNoLongerHasIsDeletedAlreadyATokenItNoLongerTakesIsRenewedOnceAndSentAgainOneItThenRefusesForGoodGoneOneItCantRenewKept() =
        inTime {
            // Its type read past any namespace, as Cognito's JSON protocol allows.
            val type = "com.amazonaws.cognito.identity.idp.model#UserNotFoundException"
            val gone = MemoryStore.holding(admin("a1"))
            assertNull(signIn(gone, cognitoDouble(Answers(null).endpoint(), Answers(400 to cognitoError(type)).endpoint())).deleteUser())
            assertNull(gone.data)

            val tokens = Answers(200 to granted(admin("a2")))
            val endpoint = cognitoDouble(tokens.endpoint(), Answers(400 to cognitoError("NotAuthorizedException")).endpoint())
            val renewed = MemoryStore.holding(admin("a1"))
            val phone = signIn(renewed, endpoint)
            assertEquals(SendResult.Status(400), phone.deleteUser()) // refused again, renewed: said
            assertEquals(listOf(admin("a1"), admin("a2")), deletesSent(endpoint))
            assertEquals(admin("a2"), renewed.tokens?.access)

            tokens.set(null) // Cognito out of reach: kept to try again
            assertEquals(SendResult.NetworkError, phone.deleteUser())
            assertEquals(admin("a2"), renewed.tokens?.access)

            tokens.set(400 to refusal("invalid_grant")) // the sign-in itself is gone
            assertNull(phone.deleteUser())
            assertNull(renewed.data)
            assertFalse(phone.signedIn().first())
        }

    @Test
    fun anExpiredTokenIsRenewedBeforeDeleteUserTakesItAsOneGivenToTheApiIs() =
        inTime {
            val endpoint = cognitoDouble(Answers(200 to granted(admin("a2"))).endpoint(), Answers(200 to "{}").endpoint())
            val now = Now()
            val phone = signIn(MemoryStore.holding(admin("a1")), endpoint, now)
            now.set(4000)
            assertNull(phone.deleteUser())
            assertEquals(listOf(admin("a2")), deletesSent(endpoint))
        }

    @Test
    fun onceTheApiHasDeletedTheAccountNoTokenGoesToTheApiThroughARenewalAndARelaunchTooWhileDeleteUserStillTakesOneASignOutForgetsIt() =
        inTime {
            // A store that can't take it then takes it at the next ask.
            val endpoint = cognitoDouble(Answers(200 to granted(admin("a2"))).endpoint(), Answers(500 to "{}").endpoint())
            val store = MemoryStore.holding(admin("a1"))
            val phone = signIn(store, endpoint)
            assertFalse(phone.deletionPending())
            assertEquals(admin("a1"), phone.accessToken()) // read while the store can be
            store.setLocked(true)
            phone.accountDeleted()
            assertNull(phone.accessToken())
            assertNull(store.tokens?.deleted) // locked: not taken yet
            store.setLocked(false)
            assertTrue(phone.deletionPending())
            assertEquals(true, store.tokens?.deleted)

            assertTrue(phone.refresh())
            assertEquals(listOf(admin("a2"), true), store.tokens?.let { listOf(it.access, it.deleted) })
            assertNull(phone.accessToken())

            val relaunched = signIn(store, endpoint)
            assertTrue(relaunched.deletionPending())
            assertNull(relaunched.accessToken())
            assertTrue(relaunched.signedIn().first())
            assertEquals(SendResult.Status(500), relaunched.deleteUser())
            assertEquals(listOf(admin("a2")), deletesSent(endpoint))

            relaunched.signOut()
            assertFalse(relaunched.deletionPending())
            assertNull(store.data)
        }

    @Test
    fun aDeleteUserWhoseCallerIsCancelledOnceItsOnItsWayGoesOnItsTokensForgottenOnceDeletedAndOneWhoseScopeEndedIsNoAnswer() =
        inTime {
            // A sign-in's exchange's pattern (AN6b): a caller cancelled stops waiting, and what it set going goes on.
            val endpoint = HeldEndpoint()
            val store = MemoryStore.holding(admin("a1"))
            val phone = signIn(store, endpoint)
            val caller = async { phone.deleteUser() }
            endpoint.received(1)
            caller.cancelAndJoin()
            endpoint.answer(200, "{}")
            eventually { store.data == null }
            assertTrue(caller.isCancelled)
            assertFalse(phone.signedIn().first())
            // The app's scope ended: no answer, never its cancel thrown, and nothing sent.
            val ended = MemoryStore.holding(admin("b1"))
            val stopped = SignIn(cognito, ended, CoroutineScope(Job().apply { cancel() }), endpoint, Now(), gated = false)
            assertEquals(SendResult.NetworkError, stopped.deleteUser())
            assertEquals(admin("b1"), ended.tokens?.access)
            assertEquals(1, endpoint.sent)
        }

    @Test
    fun deleteUserGoesOnTheWireOverTheAppsOwnTransportCognitosTwoHeadersAndTheTokenInItsBodyNoAuthorizationItsAnswerReadThere() =
        inTime {
            // DeleteUser over the API client's OkHttp (AN3d), a local server in Cognito's place: the pool's
            // endpoint is Cognito's own https host, so the test's client takes each request there, and finds
            // every name on this machine, never a real network.
            MockWebServer().use { server ->
                val json = headersOf("Content-Type", "application/x-amz-json-1.1")
                server.enqueue(MockResponse(200, json, "{}"))
                server.enqueue(MockResponse(400, json, cognitoError("com.amazonaws.cognito.identity.idp.model#UserNotFoundException")))
                server.start()
                val asked = CopyOnWriteArrayList<String>()
                val client =
                    OkHttpTransport.makeClient().newBuilder()
                        .dns { Dns.SYSTEM.lookup("localhost") }
                        .addInterceptor { chain ->
                            asked += chain.request().url.toString()
                            chain.proceed(chain.request().newBuilder().url(server.url("/")).build())
                        }
                        .build()
                for (name in listOf("a1", "b1")) {
                    val store = MemoryStore.holding(admin(name))
                    assertNull(SignIn(cognito, store, scope, OkHttpTransport(client), Now(), gated = false).deleteUser(), name)
                    assertNull(store.data, name) // deleted, and then a user Cognito no longer has
                }
                assertEquals(listOf(DELETE_USER_ENDPOINT, DELETE_USER_ENDPOINT), asked)
                val sent = server.takeRequest()
                assertEquals("POST / HTTP/1.1", sent.requestLine)
                assertEquals("application/x-amz-json-1.1", sent.headers["Content-Type"])
                assertEquals("AWSCognitoIdentityProviderService.DeleteUser", sent.headers["X-Amz-Target"])
                assertNull(sent.headers["Authorization"])
                assertEquals(admin("a1"), accessToken(sent.body?.toByteArray()))
                assertEquals(admin("b1"), accessToken(server.takeRequest().body?.toByteArray()))
            }
        }

    @Test
    fun deleteUserSendsOnlyTheTokensOfTheSignInItBeganWithAnotherLandedDuringItsRenewalOrItsTryIsNoAnswerItsTokensKept() =
        inTime {
            // No iOS twin (Q4): iOS's sends whatever tokens there are after its renewal.
            val tokens = HeldEndpoint()
            val deletes = TransportDouble.answering(200, "{}")
            val (store, now) = MemoryStore.holding(admin("a1")) to Now()
            val phone = signIn(store, cognitoDouble(tokens, deletes), now)
            now.set(4000) // a1 has expired
            val deleting = async { phone.deleteUser() }
            tokens.received(1) // its renewal, on its way
            val signingIn = async { phone.signIn(browser = signsIn) } // another account's
            tokens.received(2)
            tokens.answer(200, granted(admin("b1"), refresh = "refresh-b"), newestOnly = true)
            signingIn.await()
            tokens.answer(200, granted(admin("a2"))) // the renewal's, about a1's refresh token
            assertEquals(SendResult.NetworkError, deleting.await())
            assertTrue(deletes.sent.isEmpty())
            assertEquals(listOf(admin("b1"), "refresh-b"), store.tokens?.let { listOf(it.access, it.refresh) })

            // One landed while DeleteUser was on its way, Cognito no longer taking a1's token: no renewal of
            // the other's, no second try.
            val (arrived, answer, tries) = Triple(CompletableDeferred<Unit>(), CompletableDeferred<Unit>(), AtomicInteger())
            val held =
                TransportDouble {
                    if (tries.incrementAndGet() > 1) return@TransportDouble HttpAnswer(200, emptyMap(), "{}".encodeToByteArray())
                    arrived.complete(Unit)
                    answer.await()
                    HttpAnswer(400, emptyMap(), cognitoError("NotAuthorizedException").encodeToByteArray())
                }
            val granting = TransportDouble.answering(200, granted(admin("b1"), refresh = "refresh-b"))
            val other = MemoryStore.holding(admin("a1"))
            val second = signIn(other, cognitoDouble(granting, held))
            val trying = async { second.deleteUser() }
            arrived.await()
            second.signIn(browser = signsIn)
            answer.complete(Unit)
            assertEquals(SendResult.NetworkError, trying.await())
            assertEquals(1, tries.get())
            assertEquals(1, granting.sent.size) // the sign-in's exchange alone
            assertEquals(admin("b1"), other.tokens?.access)
        }
}
