package com.bali.core

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * The app's config, read: AppConfigTests.swift's `reads`. Its `agree`, which pins the keys to where
 * the build sets them, comes with Android's side, sign-in's (AN6).
 */
class AppConfigTest {
    private val values =
        mapOf(
            "BaliAPIURL" to "https://api.bali.test", "BaliCognitoDomain" to "https://bali.auth.test",
            "BaliCognitoClientID" to "client", "BaliCognitoRedirectURI" to "bali://auth/callback",
            "BaliPortalURL" to "https://portal.bali.test",
        )

    @Test
    fun theFiveKeysMakeTheConfigAnyOneOfThemMissingOrEmptyNoneNotSetUp() {
        val config = assertNotNull(AppConfig.from(values))
        assertEquals(URI("https://api.bali.test"), config.api)
        assertEquals(URI("https://portal.bali.test"), config.portal)
        assertEquals(Cognito(URI("https://bali.auth.test"), "client", URI("bali://auth/callback")), config.cognito)
        for (key in AppConfig.Key.entries) {
            assertNull(AppConfig.from(values - key.key), "$key missing")
            assertNull(AppConfig.from(values + (key.key to "")), "$key empty")
        }
    }

    @Test
    fun aValueThatIsNotAUrlWhereOneIsWantedOrNotTextIsNoneToo() {
        val urls = AppConfig.Key.entries - AppConfig.Key.CognitoClientId
        for (key in urls) assertNull(AppConfig.from(values + (key.key to "not a url")), "$key")
        for (key in AppConfig.Key.entries) assertNull(AppConfig.from(values + (key.key to 42)), "$key")
        // A client id is any text.
        assertEquals("not a url", AppConfig.from(values + ("BaliCognitoClientID" to "not a url"))?.cognito?.clientId)
    }
}
