package com.bali.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first

/**
 * The tokens: given, renewed, and signed out only by Cognito's own no (B4). SignInTests.swift's
 * TokenTests through `SignIn`, but `emailNoDefault` (AN6a's, in [TokensTest]). Each check that
 * nothing happens waits for a point the test marks first (a request held, a call's end, a caller's
 * check of its token's expiry), never a window of real time.
 */
class SignInTokensTest : SignIns() {
    @Test
    fun theSignInGivesTheAccessTokenUntilAMinuteBeforeItsOwnLifetimeEndsWhateverThePhonesClockThenRenewsIt() =
        inTime {
            val endpoint = TransportDouble.answering(200, granted(jwt("a2")))
            val now = Now()
            val phone = signIn(MemoryStore.holding(jwt("a1")), endpoint, now)
            now.set(3600 - 61)
            assertEquals(jwt("a1"), phone.accessToken())
            assertTrue(endpoint.sent.isEmpty())
            now.set(3600 - 59) // inside the margin: renewed, never sent as it is
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals(1, endpoint.sent.size)
        }

    @Test
    fun anExpiredTokenIsRenewedWithTheRefreshTokenBeforeOneIsGivenAndTheEngineTold() =
        inTime {
            val endpoint = TransportDouble.answering(200, granted(jwt("a2")))
            val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
            val phone = signIn(store, endpoint, now, told)
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken())
            val sent = endpoint.sent.first()
            assertEquals(listOf("POST", TOKEN_ENDPOINT), listOf(sent.method, sent.url.toString()))
            assertEquals(mapOf("grant_type" to "refresh_token", "client_id" to "phone-client", "refresh_token" to "refresh-1"), fields(sent.body))
            assertEquals(1, told.count)
            // The refresh token is kept when the answer brings none; a fresh token lives its own hour.
            assertEquals(listOf(jwt("a2"), "refresh-1"), store.tokens?.let { listOf(it.access, it.refresh) })
            now.set(4000 + 3539)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals(1, endpoint.sent.size)
        }

    @Test
    fun aRefreshTokenCognitoRotatesReplacesTheOneKept() =
        inTime {
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, TransportDouble.answering(200, granted(jwt("a2"), refresh = "refresh-2")), now)
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals("refresh-2", store.tokens?.refresh)
        }

    @Test
    fun aRotatedRefreshTokenTheStoreCantTakeRightThenIsSavedAtTheNextAsk() =
        inTime {
            val endpoint = TransportDouble.answering(200, granted(jwt("a2"), refresh = "refresh-2"))
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, endpoint, now)
            assertEquals(jwt("a1"), phone.accessToken()) // read while the store can be
            store.setLocked(true)
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken()) // renewed: the old refresh token is spent
            assertEquals("refresh-1", store.tokens?.refresh) // the store refused the new one
            store.setLocked(false)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals(listOf("refresh-2", jwt("a2")), store.tokens?.let { listOf(it.refresh, it.access) })
            assertEquals(1, endpoint.sent.size)
        }

    @Test
    fun cognitoRefusingTheRefreshTokenSignsTheStudentOutTheOneRealNo() =
        inTime {
            val endpoint = TransportDouble.answering(400, refusal("invalid_grant"))
            val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
            val phone = signIn(store, endpoint, now, told)
            val watching = phone.signedIn()
            now.set(4000)
            assertNull(phone.accessToken())
            assertNull(store.data)
            assertFalse(watching.first()) // the newest a watcher was told
            // Signed out: only a sign-in can give a token, so the engine's refresh is false at once.
            assertFalse(phone.refresh())
            assertEquals(1, endpoint.sent.size)
            assertEquals(0, told.count)
        }

    @Test
    fun aSignOutTheStoreCantMakeRightThenIsMadeAtTheNextAskTheRefusedRefreshTokenNeverReadBack() =
        inTime {
            val endpoint = TransportDouble.answering(400, refusal("invalid_grant"))
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, endpoint, now)
            assertEquals(jwt("a1"), phone.accessToken()) // read while the store can be
            store.setLocked(true)
            now.set(4000)
            assertNull(phone.accessToken()) // Cognito's no
            assertFalse(phone.signedIn().first())
            assertEquals("refresh-1", store.tokens?.refresh) // the store couldn't forget it then
            store.setLocked(false)
            assertNull(phone.accessToken())
            assertNull(store.data) // forgotten at this ask
            val relaunched = signIn(store, endpoint, now)
            assertFalse(relaunched.signedIn().first())
            assertEquals(1, endpoint.sent.size)
        }

    @Test
    fun theTokenTheApiRefusedIsntGivenAfterARelaunchEitherThoughNoRenewalCame() =
        inTime {
            val answers = Answers(null) // Cognito out of reach
            val endpoint = answers.endpoint()
            val store = MemoryStore.holding(jwt("a1"))
            assertFalse(signIn(store, endpoint).refresh())
            val relaunched = signIn(store, endpoint)
            assertNull(relaunched.accessToken()) // renewed first, never a1 again
            answers.set(200 to granted(jwt("a2")))
            assertEquals(jwt("a2"), relaunched.accessToken())
            assertEquals(3, endpoint.sent.size)
        }

    @Test
    fun noAnswerAServerErrorThrottlingOrAnotherRefusalKeepsTheTokensNoOneSaidNo() =
        inTime {
            val replies =
                listOf(
                    null, 500 to "{}", 503 to "<html>", 429 to refusal("too_many_requests"), 400 to refusal("invalid_client"),
                    400 to refusal("unauthorized_client"), 200 to "not json",
                    302 to refusal("invalid_grant"), // a redirect is not Cognito
                    200 to """{"access_token":42}""", // a field of another type: no answer at all
                )
            for (reply in replies) {
                val answers = Answers(reply)
                val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
                val phone = signIn(store, answers.endpoint(), now, told)
                now.set(4000)
                assertNull(phone.accessToken(), "$reply") // expired, and not renewed: none right now
                assertEquals("refresh-1", store.tokens?.refresh, "$reply")
                assertTrue(phone.signedIn().first(), "$reply")
                assertEquals(0, told.count, "$reply")
                // The next request tries again, and a renewal then gives one.
                answers.set(200 to granted(jwt("a2")))
                assertEquals(jwt("a2"), phone.accessToken(), "$reply")
                assertEquals(1, told.count, "$reply")
            }
        }

    @Test
    fun theEnginesRefreshTheRefusedTokenIsNeverGivenAgainAndAFreshOneIsTrue() =
        inTime {
            val answers = Answers(200 to granted(jwt("a2")))
            val told = Told()
            val phone = signIn(MemoryStore.holding(jwt("a1")), answers.endpoint(), told = told)
            assertTrue(phone.refresh())
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals(0, told.count) // the engine sends everything again itself
            // Refused again, and Cognito out of reach: false, and the token the API refused isn't given,
            // until a renewal can give a fresh one, which the engine is told of.
            answers.set(null)
            assertFalse(phone.refresh())
            assertNull(phone.accessToken())
            answers.set(200 to granted(jwt("a3")))
            assertEquals(jwt("a3"), phone.accessToken())
            assertEquals(1, told.count)
        }

    @Test
    fun theEnginesRefreshIsFalseAtOnceWhenNobodyIsSignedInOnlyTheStudentCanSignIn() =
        inTime {
            val endpoint = TransportDouble.answering(200, granted(jwt("a1")))
            val phone = signIn(MemoryStore(), endpoint)
            assertFalse(phone.refresh())
            assertNull(phone.accessToken())
            assertTrue(endpoint.sent.isEmpty())
        }

    @Test
    fun oneRenewalAtATimeSharedByEveryCaller() =
        inTime {
            val endpoint = HeldEndpoint()
            val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
            val phone = signIn(store, endpoint, now, told)
            now.set(4000)
            val one = async { phone.accessToken() }
            endpoint.received(1)
            val two = async { phone.accessToken() }
            val three = async { phone.refresh() }
            // Each has joined the renewal under way: two checked its token's expiry, three marked it refused.
            eventually { now.reads == 2 && store.tokens?.until == Tokens.DISTANT_PAST }
            assertEquals(1, endpoint.sent)
            endpoint.answer(200, granted(jwt("a2")))
            assertEquals(listOf(jwt("a2"), jwt("a2")), listOf(one.await(), two.await()))
            assertTrue(three.await())
            assertEquals(listOf(1, 1), listOf(endpoint.sent, told.count))
        }

    @Test
    fun aRenewalTheEnginesRefreshStartedIsSharedTooAndTheEngineIsntToldOfIt() =
        inTime {
            val endpoint = HeldEndpoint()
            val (now, told) = Now() to Told()
            val phone = signIn(MemoryStore.holding(jwt("a1")), endpoint, now, told)
            val refreshing = async { phone.refresh() }
            endpoint.received(1)
            val asking = async { phone.accessToken() }
            eventually { now.reads == 1 } // it checked its token's expiry, and joined the renewal under way
            endpoint.answer(200, granted(jwt("a2")))
            assertTrue(refreshing.await())
            assertEquals(jwt("a2"), asking.await())
            assertEquals(1, endpoint.sent)
            assertEquals(0, told.count) // refresh's true: the engine sends everything again itself
        }

    @Test
    fun aCallerCancelledWhileItWaitsStopsWaitingAndTheRenewalGoesOnForTheOthersItsTokenKeptAndTheEngineTold() =
        inTime {
            // No iOS twin: Swift's caller can't stop waiting on its task's value.
            val endpoint = HeldEndpoint()
            val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
            val phone = signIn(store, endpoint, now, told)
            now.set(4000)
            // The renewal's own starter cancelled while another waits on it.
            val one = async { phone.accessToken() }
            endpoint.received(1)
            val two = async { phone.accessToken() }
            eventually { now.reads == 2 } // two checked its token's expiry, and joined the renewal under way
            one.cancelAndJoin()
            endpoint.answer(200, granted(jwt("a2")))
            assertEquals(jwt("a2"), two.await())
            assertTrue(one.isCancelled)
            assertEquals(listOf(1, 1), listOf(endpoint.sent, told.count))
            // Every caller cancelled: the renewal goes on to its end, its token kept and the engine told.
            now.set(8000)
            val last = async { phone.accessToken() }
            endpoint.received(2)
            last.cancelAndJoin()
            endpoint.answer(200, granted(jwt("a3")))
            eventually { told.count == 2 }
            assertEquals(jwt("a3"), store.tokens?.access)
            assertEquals(jwt("a3"), phone.accessToken())
            assertEquals(2, endpoint.sent)
        }

    @Test
    fun theTokenIsNeverAThrowAStoreOrTransportFailingAnyWayAHookThatThrowsOrTheRenewalsOwnCancelGiveNone() =
        inTime {
            // The drain asks for one before every send (AN5b): a throw would stop every run after it too.
            val broken =
                object : TokenStore {
                    override fun load(): ByteArray? = error("broken")

                    override fun save(tokens: ByteArray) {
                        error("broken")
                    }

                    override fun clear() {
                        error("broken")
                    }
                }
            val unreadable = signIn(broken, TransportDouble.answering(200, granted(jwt("a2"))))
            assertNull(unreadable.accessToken())
            assertFalse(unreadable.refresh())
            // A transport throwing what none should: no answer, the tokens kept.
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            now.set(4000)
            val odd = signIn(store, TransportDouble { throw IllegalStateException("odd") }, now)
            assertNull(odd.accessToken())
            assertFalse(odd.refresh())
            assertEquals("refresh-1", store.tokens?.refresh)
            // The engine's hook throwing: the renewal's token is given all the same, and a sign-in kept,
            // never said as failed (it throws only a SignInError).
            val hooked = signIn(MemoryStore.holding(jwt("a1")), TransportDouble.answering(200, granted(jwt("a2"))), now)
            hooked.whenTokenArrives { error("the engine is gone") }
            assertEquals(jwt("a2"), hooked.accessToken())
            val signingIn = signIn(MemoryStore(), TransportDouble.answering(200, granted(jwt("a3"), refresh = "refresh-3")), now)
            signingIn.whenTokenArrives { error("the engine is gone") }
            signingIn.signIn(browser = signsIn)
            assertEquals(jwt("a3"), signingIn.accessToken())
            // The renewal cancelled with the sign-in's scope: none for its callers, never a throw; and,
            // the scope ended, none starts again (the app's scope lives as long as its process).
            val ending = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val held = HeldEndpoint()
            val doomed = SignIn(cognito, MemoryStore.holding(jwt("a1")), ending, held, now, gated = false)
            val asking = async { doomed.accessToken() }
            held.received(1)
            ending.cancel()
            assertNull(asking.await())
            assertFalse(doomed.refresh())
            assertNull(doomed.accessToken())
        }

    @Test
    fun aStoreThatCantBeReadRightNowIsNeverASignOut() =
        inTime {
            val store = MemoryStore.holding(jwt("a1"))
            val endpoint = TransportDouble.answering(200, granted(jwt("a2")))
            val phone = signIn(store, endpoint)
            store.setLocked(true)
            assertNull(phone.accessToken())
            assertFalse(phone.refresh())
            val watching = phone.signedIn()
            assertNull(atOnce(watching)) // not known yet: neither in nor out
            store.setLocked(false)
            assertEquals(jwt("a1"), phone.accessToken())
            assertTrue(watching.first()) // told once the store could be read
            assertTrue(endpoint.sent.isEmpty())
        }

    @Test
    fun signingOutForgetsTheTokensAStoreThatCantForgetThemNowChangesNothing() =
        inTime {
            val store = MemoryStore.holding(jwt("a1"))
            val phone = signIn(store, TransportDouble.answering(500))
            assertEquals(jwt("a1"), phone.accessToken())
            store.setLocked(true)
            assertFailsWith<MemoryStore.Locked> { phone.signOut() }
            assertEquals(jwt("a1"), phone.accessToken())
            store.setLocked(false)
            val watching = phone.signedIn()
            phone.signOut()
            assertNull(store.data)
            assertNull(phone.accessToken())
            assertFalse(watching.first())
        }

    @Test
    fun whoIsSignedInIsTheAccountTheTokensAreForTheSameAcrossARenewalNoneOnceSignedOutAndNoneForTokensThatNameNone() =
        inTime {
            // C6b's review: never a stand-in a renewal could change.
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, TransportDouble.answering(200, granted(jwt("a1"), refresh = "refresh-2")), now)
            assertEquals("a1", phone.account())
            now.set(4000)
            assertEquals(jwt("a1"), phone.accessToken())
            assertEquals("refresh-2", store.tokens?.refresh)
            assertEquals("a1", phone.account())
            phone.signOut()
            assertNull(phone.account())
            val unread = signIn(MemoryStore.holding("not-a-jwt"), TransportDouble.answering(500))
            assertEquals("not-a-jwt", unread.accessToken())
            assertNull(unread.account())
        }

    @Test
    fun whoseSignInThisIsTheEmailCognitosIdTokenNamesKeptAndRenewedWithTheTokensAndAnotherStudentsNeverTheLastOnes() =
        inTime {
            // #147: a renewal naming none keeps it (the same account's), none once signed out.
            val answers = Answers(200 to granted(jwt("a1"), refresh = "refresh-a", email = "ana@bali.test"))
            val (store, now) = MemoryStore() to Now()
            val phone = signIn(store, answers.endpoint(), now)
            assertNull(phone.email())
            phone.signIn(browser = signsIn)
            assertEquals("ana@bali.test", phone.email())
            assertEquals("ana@bali.test", store.tokens?.email)
            answers.set(200 to granted(jwt("a2"), email = "ana.r@bali.test"))
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals("ana.r@bali.test", phone.email())
            answers.set(200 to granted(jwt("a3")))
            now.set(8000)
            assertEquals(jwt("a3"), phone.accessToken())
            assertEquals("ana.r@bali.test", phone.email())
            phone.signOut()
            assertNull(phone.email())
            answers.set(200 to granted(jwt("b1"), refresh = "refresh-b", email = "bea@bali.test"))
            phone.signIn(browser = signsIn)
            assertEquals("bea@bali.test", phone.email())
            answers.set(200 to granted(jwt("c1"), refresh = "refresh-c"))
            phone.signIn(browser = signsIn)
            assertEquals("c1", phone.account())
            assertNull(phone.email())
            assertNull(store.tokens?.email)
        }

    @Test
    fun tokensKeptBeforeTheEmailExistedStillSignTheStudentInNoEmailToSayUntilARenewalsIdTokenNamesOne() =
        inTime {
            val store = MemoryStore()
            store.save("""{"access":"${jwt("a1")}","refresh":"refresh-1","until":"2026-09-21T15:12:20Z"}""".encodeToByteArray())
            val now = Now()
            val phone = signIn(store, TransportDouble.answering(200, granted(jwt("a2"), email = "ana@bali.test")), now)
            assertTrue(phone.signedIn().first())
            assertEquals(jwt("a1"), phone.accessToken())
            assertNull(phone.email())
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals("ana@bali.test", phone.email())
            assertEquals("refresh-1", store.tokens?.refresh)
        }

    @Test
    fun everyWayThePhoneMakesTokensKeepsTheEmailItsAnswerNamesAndARelaunchReadsEachBack() =
        inTime {
            // #159's and #164's reviews, by what the phone does: a sign-in, a renewal at the token's expiry,
            // and the engine's renewal after the API refused one, a renewal naming none keeping the one kept.
            val answers = Answers(200 to granted(jwt("a1"), refresh = "refresh-a", email = "ana@bali.test"))
            val endpoint = answers.endpoint()
            val (store, now) = MemoryStore() to Now()
            val phone = signIn(store, endpoint, now)

            /** The email the phone names now, and the one a relaunch reads back from the store. */
            suspend fun named() = listOf(phone.email(), signIn(store, endpoint, now).email())
            phone.signIn(browser = signsIn)
            assertEquals(listOf("ana@bali.test", "ana@bali.test"), named())
            answers.set(200 to granted(jwt("a2"), email = "ana.r@bali.test"))
            now.set(4000)
            assertEquals(jwt("a2"), phone.accessToken())
            assertEquals(listOf("ana.r@bali.test", "ana.r@bali.test"), named())
            answers.set(200 to granted(jwt("a3"), email = "ana.rodriguez@bali.test"))
            assertTrue(phone.refresh())
            assertEquals(listOf("ana.rodriguez@bali.test", "ana.rodriguez@bali.test"), named())
            answers.set(200 to granted(jwt("a4")))
            assertTrue(phone.refresh())
            assertEquals(jwt("a4"), phone.accessToken())
            assertEquals(listOf("ana.rodriguez@bali.test", "ana.rodriguez@bali.test"), named())
        }

    @Test
    fun aSignOutWhileARenewalRunsIsntUndoneByItsAnswer() =
        inTime {
            val endpoint = HeldEndpoint()
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, endpoint, now)
            now.set(4000)
            val renewal = async { phone.accessToken() }
            endpoint.received(1)
            phone.signOut()
            endpoint.answer(200, granted(jwt("a2")))
            assertNull(renewal.await())
            assertNull(store.data)
            assertNull(phone.accessToken())
        }

    @Test
    fun aSignOutWhileASignInsExchangeRunsLeavesTheSignInTheStudentStartedStandingAsIOSsDoes() =
        inTime {
            // Claude Review's note on #518: the exchange's answer is the sign-in's own, kept unguarded.
            val endpoint = HeldEndpoint()
            val (store, told) = MemoryStore.holding(jwt("a1")) to Told()
            val phone = signIn(store, endpoint, told = told)
            val signingIn = async { phone.signIn(browser = signsIn) }
            endpoint.received(1)
            phone.signOut()
            assertNull(store.data)
            endpoint.answer(200, granted(jwt("b1"), refresh = "refresh-b"))
            signingIn.await()
            assertEquals(jwt("b1"), phone.accessToken())
            assertEquals("refresh-b", store.tokens?.refresh)
            assertEquals(1, told.count)
        }

    @Test
    fun aSignInWhileARenewalRunsStandsEvenWhenCognitoRefusesTheRefreshTokenLetGo() =
        inTime {
            val endpoint = HeldEndpoint()
            val (store, now, told) = Triple(MemoryStore.holding(jwt("a1")), Now(), Told())
            val phone = signIn(store, endpoint, now, told)
            now.set(4000)
            val renewal = async { phone.accessToken() }
            endpoint.received(1)
            val signingIn = async { phone.signIn(browser = signsIn) }
            endpoint.received(2)
            endpoint.answer(200, granted(jwt("b1"), refresh = "refresh-b"), newestOnly = true)
            signingIn.await()
            endpoint.answer(400, refusal("invalid_grant")) // the renewal's, about refresh-1
            assertEquals(jwt("b1"), renewal.await()) // the sign-in's token, the one there is now
            assertEquals("refresh-b", store.tokens?.refresh)
            assertTrue(phone.signedIn().first())
            assertEquals(1, told.count) // the sign-in's
        }

    @Test
    fun aRenewalsCallerIsGivenATokenOnlyWhileTheSignInStillPassesASignInNotThroughThe13PlusCheckOrADeletionMeanwhileGivesNone() =
        inTime {
            // No iOS twin: iOS's gives the tokens there are after a renewal, unchecked (C7-server, C4).
            val endpoint = HeldEndpoint()
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, endpoint, now, gated = true)
            phone.passed("a1")
            now.set(4000)
            val renewal = async { phone.accessToken() }
            endpoint.received(1)
            val signingIn = async { phone.signIn(browser = signsIn) } // another account's, not through the check
            endpoint.received(2)
            endpoint.answer(200, granted(jwt("b1"), refresh = "refresh-b"), newestOnly = true)
            signingIn.await()
            endpoint.answer(400, refusal("invalid_grant")) // the renewal's, about a1's refresh token
            assertNull(renewal.await())
            assertEquals(jwt("b1"), phone.deletionToken("b1")) // the check's own read's
            // The API deleting the account while a renewal runs: neither token from then on.
            now.set(8000)
            val deleting = async { phone.deletionToken("b1") }
            endpoint.received(3)
            phone.accountDeleted("b1")
            endpoint.answer(200, granted(jwt("b2")))
            assertNull(deleting.await())
            assertEquals(jwt("b2"), store.tokens?.access)
            assertEquals(true, store.tokens?.deleted)
        }

    @Test
    fun aTokenWhoseLifetimeCantBeReadIsGivenUntilTheApiRefusesIt() =
        inTime {
            val now = Now()
            val phone = signIn(MemoryStore.holding("opaque"), TransportDouble.answering(200, granted(jwt("a2"))), now)
            now.set(30 * 86_400)
            assertEquals("opaque", phone.accessToken())
            assertTrue(phone.refresh())
            assertEquals(jwt("a2"), phone.accessToken())
        }

    @Test
    fun gatedTheApiIsGivenNoTokenUntilThe13PlusCheckButADeletionsAndTheChecksOwnReadsPassedLetsTheAccountThrough() =
        inTime {
            // C7-server: no renewal for a token it wouldn't give; `passed` for the account its tokens name,
            // kept through a renewal and a relaunch; another account's, or nobody's, changes nothing; an
            // account the API deleted gives neither token.
            val renewed = jwt("a1", lifetime = 7200) // a renewal keeps the account its sign-in is
            val endpoint = TransportDouble.answering(200, granted(renewed))
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, endpoint, now, gated = true)
            assertNull(phone.accessToken())
            assertFalse(phone.checked())
            assertEquals(jwt("a1"), phone.deletionToken("a1"))
            now.set(3600) // a1 has expired
            assertNull(phone.accessToken())
            assertTrue(endpoint.sent.isEmpty())
            assertEquals(renewed, phone.deletionToken("a1"))
            phone.passed("b1") // another account's
            assertNull(phone.accessToken())
            assertFalse(phone.checked())
            phone.passed("a1") // the account its renewed tokens name: their sub
            assertEquals(renewed, phone.accessToken())
            assertEquals(true, store.tokens?.checked)
            assertNull(phone.yes())
            // Through a renewal, and a relaunch over the same store.
            assertTrue(phone.refresh())
            assertEquals(true, store.tokens?.checked)
            val relaunched = signIn(store, endpoint, now, gated = true)
            assertTrue(relaunched.checked())
            assertEquals(renewed, relaunched.accessToken())
            phone.accountDeleted("a1")
            assertNull(phone.deletionToken("a1"))
            assertNull(phone.accessToken())
            // Nobody signed in: nothing to let through.
            val nobody = signIn(MemoryStore(), endpoint, gated = true)
            nobody.passed(null)
            assertFalse(nobody.checked())
            assertNull(nobody.accessToken())
            // Gated unless said otherwise, so a sign-in built without the flag fails closed (santa's review).
            val unsaid = SignIn(cognito, MemoryStore.holding(jwt("a1")), scope, endpoint, Now())
            assertNull(unsaid.accessToken())
            assertEquals(jwt("a1"), unsaid.deletionToken("a1"))
        }

    @Test
    fun oneAccountsTokensAreItsAloneNoneNorAnyRenewalWhileAnothersSignInIsHeldNoneAfterARenewalALandingSignInLetGo() =
        inTime {
            // The owner, 2026-11-10: "Close it now" (AN9h): a deletion's token, the 13+ check's read's, its yes's, and the
            // renewal a 401 asks for, each the account's alone, its `sub`, checked before a renewal and after it.
            val renewed = jwt("a1", lifetime = 7200)
            val answering = TransportDouble.answering(200, granted(renewed))
            val (store, now) = MemoryStore.holding(jwt("a1")) to Now()
            val phone = signIn(store, answering, now, gated = true)
            phone.passed("a1", recording = "y1")
            assertEquals(listOf(jwt("a1"), jwt("a1"), "y1"), listOf(phone.deletionToken("a1"), phone.accessToken("a1"), phone.yes("a1")))
            for (other in listOf("b1", null)) {
                assertEquals(listOf(null, null, null), listOf(phone.deletionToken(other), phone.accessToken(other), phone.yes(other)), "$other")
                assertFalse(phone.refresh(other), "$other")
            }
            assertEquals(jwt("a1"), phone.accessToken("a1")) // never marked refused for another
            now.set(4000) // a1 has expired: nothing renewed for another account
            assertNull(phone.deletionToken("b1"))
            assertNull(phone.accessToken("b1"))
            assertTrue(answering.sent.isEmpty())
            assertEquals(renewed, phone.deletionToken("a1")) // its own, renewed
            assertTrue(phone.refresh("a1"))
            assertEquals(listOf(renewed, "y1"), listOf(phone.accessToken("a1"), phone.yes("a1")))

            // b1's sign-in landing while a1's tokens are renewed for a1: none for a1, and its refresh false; b1's for b1.
            for (refreshing in listOf(false, true)) {
                val held = HeldEndpoint()
                val (kept, later) = MemoryStore.holding(jwt("a1")) to Now()
                val second = signIn(kept, held, later)
                if (!refreshing) later.set(4000) // a1 has expired: renewed first
                val asking = async { if (refreshing) second.refresh("a1").toString() else second.deletionToken("a1") }
                held.received(1)
                val signingIn = async { second.signIn(browser = signsIn) }
                held.received(2)
                held.answer(200, granted(jwt("b1"), refresh = "refresh-b"), newestOnly = true)
                signingIn.await()
                held.answer(200, granted(renewed)) // the renewal's, about a1's refresh token
                assertEquals(if (refreshing) "false" else null, asking.await(), "$refreshing")
                assertEquals(jwt("b1"), second.deletionToken("b1"), "$refreshing")
                assertEquals(2, held.sent, "$refreshing")
            }
        }

    @Test
    fun aSignUpsYesKeepsItsSignInThroughThe13PlusCheckBeforeAnythingHearsOfItAndTheYesWaitsUntilSettled() =
        inTime {
            // C7-server: the tokens in the store as the engine is told and a watcher hears, so its token is
            // given at once, gated; `recorded` lets go of that yes alone, an answer of 13 or older after a
            // sign-in keeps one as `passed` does, and a sign-in that doesn't finish keeps nothing.
            val endpoint = TransportDouble.answering(200, granted(jwt("new"), refresh = "refresh-1"))
            val (store, heard) = MemoryStore() to Heard()
            val phone = SignIn(cognito, store, scope, endpoint, Now(), gated = true)
            phone.whenTokenArrives { heard.add(store.tokens?.let { "told ${it.checked == true} ${it.yes ?: "none"}" }.orEmpty()) }
            val watcher = phone.signedIn()
            val watching = async { if (watcher.first { it }) heard.add(if (store.tokens?.checked == true) "watched, kept" else "not kept") }
            phone.signIn(HostedPage.SignUp, yes = "y1", browser = signsIn)
            watching.await()
            assertEquals(setOf("told true y1", "watched, kept"), heard.added.toSet(), "${heard.added}")
            assertEquals(jwt("new"), phone.accessToken())
            assertEquals("y1", phone.yes())
            phone.recorded("y0") // another yes: this one waits on
            assertEquals("y1", phone.yes())
            phone.recorded("y1")
            assertEquals(listOf(null, null), listOf(phone.yes(), store.tokens?.yes))
            assertTrue(phone.checked())
            // After a sign-in, the question answered 13 or older.
            phone.passed("new", recording = "y2")
            assertEquals(listOf("y2", "y2"), listOf(phone.yes(), store.tokens?.yes))

            val failing = SignIn(cognito, MemoryStore(), scope, endpoint, Now(), gated = true)
            assertEquals(SignInError.Cancelled, assertFailsWith<SignInError> { failing.signIn(HostedPage.SignUp, yes = "y3") { throw SignInError.Cancelled } })
            assertNull(failing.yes())
            assertFalse(failing.checked())
        }
}
