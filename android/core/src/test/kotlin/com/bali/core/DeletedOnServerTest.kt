package com.bali.core

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.first

// AN9j, `409 account_deleted` read as signed out (the owner, 2026-11-12), the sign-in's half: what the API client heard, told to
// the engine with the sign-in let go, and the sign-in forgotten for it as Sign out forgets it, the account named alone, never one
// this phone's own deletion keeps for Cognito's DeleteUser. No iOS twin yet: C4d, the Mac's.

/** Bali's server's answer to a call under a deleted account's old token (C3d). */
private const val DELETED = """{"error":{"code":"conflict","reason":"account_deleted","message":"this account was deleted"}}"""

class DeletedOnServerTest : SignIns() {
    @Test
    fun theSignInForgetsTheAccountTheServerSaysIsDeletedAsSignOutForgetsItOnceThatAccountsAloneNeverOneKeptForDeleteUser() =
        inTime {
            val store = MemoryStore.holding(admin("a1"))
            val phone = signIn(store, Answers(null).endpoint())
            // Another account's, or none: nothing.
            assertFalse(phone.forgetDeleted("b1"))
            assertFalse(phone.forgetDeleted(null))
            assertEquals("a1", phone.account())
            assertTrue(phone.forgetDeleted("a1"))
            assertNull(store.data)
            assertNull(phone.account())
            assertNull(phone.accessToken())
            // Said as a sign-in gone for its account's deletion, so the account forgets what it kept of the student.
            assertEquals(Landing(signedIn = false, account = null, count = 0, deleted = true), phone.landings().first())
            assertFalse(phone.forgetDeleted("a1"))

            // This phone's own deletion, its sign-in kept for Cognito's DeleteUser: marked once, said as such, and never forgotten here.
            val kept = MemoryStore.holding(admin("a1"))
            val deleting = signIn(kept, Answers(null).endpoint())
            assertFalse(deleting.accountDeleted("b1"))
            assertTrue(deleting.accountDeleted("a1"))
            assertEquals(Landing(signedIn = true, account = "a1", count = 0, deleted = true), deleting.landings().first())
            assertFalse(deleting.accountDeleted("a1"))
            assertFalse(deleting.forgetDeleted("a1"))
            assertTrue(deleting.deletionPending())
            assertNotNull(kept.tokens)
        }

    @Test
    fun aStoreThatCantForgetTheTokensNowSignsTheStudentOutAllTheSameNeverAThrowAndForgetsThemAtTheNextAsk() =
        inTime {
            val store = MemoryStore.holding(jwt("a1"))
            val phone = signIn(store, Answers(null).endpoint())
            assertEquals("a1", phone.account())
            store.setLocked(true)
            assertTrue(phone.forgetDeleted("a1"))
            assertNull(phone.account())
            store.setLocked(false)
            assertNull(phone.accessToken())
            assertNull(store.data)
        }

    @Test
    fun whatTheApiClientHeardIsToldToTheHookWithTheSignInLetGoAHookThatThrowsOrNoneAtAllChangesNothingThere() =
        inTime {
            val phone = signIn(MemoryStore.holding(jwt("a1")), Answers(null).endpoint())
            val deleted = TransportDouble.answering(409, DELETED)
            val client = ApiClient(URI("https://api.bali.test"), phone, deleted)
            // No hook yet: the answer is the caller's, the sign-in as it was.
            assertEquals(SendResult.Status(409), client.me().result)
            assertEquals("a1", phone.account())
            // A hook that throws: the caller still hears the answer.
            phone.whenDeletedOnServer { error("broken") }
            assertEquals(SendResult.Status(409), client.forAccount("a1").me().result)
            assertEquals("a1", phone.account())
            // The engine's: told the account, free to call the sign-in back.
            val heard = Heard()
            phone.whenDeletedOnServer { account ->
                heard.add("$account")
                phone.forgetDeleted(account)
            }
            assertEquals(SendResult.Status(409), client.me().result)
            assertEquals(listOf("a1"), heard.added)
            assertNull(phone.account())
            assertEquals(3, deleted.sent.size)
        }
}
