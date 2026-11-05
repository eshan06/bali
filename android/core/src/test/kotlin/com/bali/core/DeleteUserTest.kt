package com.bali.core

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The sign-in deleting itself (C4): DeleteUserTests.swift's `mayDelete`. Cognito's DeleteUser, the
 * rest of that suite, is AN9's, with `SignIn`'s `deleteUser`.
 */
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
}
