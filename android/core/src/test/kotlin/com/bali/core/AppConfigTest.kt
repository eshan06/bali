package com.bali.core

import java.io.File
import java.net.URI
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import org.w3c.dom.Element

/**
 * The app's config, read, and pinned to where the app's build sets it: AppConfigTests.swift's `reads`
 * and `agree`, the manifest Info.plist's twin and app/build.gradle.kts project.yml's.
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

    /**
     * Every key the reader reads is the manifest's meta-data, a string the app's build makes and sets once,
     * and every Bali key there, and every value the build makes for one, is one it reads; the build's values
     * make a config once a client id is given, and none while it's empty; and the scheme the manifest
     * catches a Custom Tab's answer by is the redirect URI's, the app's id.
     */
    @Test
    fun everyKeyTheReaderReadsIsInTheAppsManifestAsAValueTheBuildSetsOnceAndTheirValuesMakeAConfig() {
        val app = File(checkNotNull(System.getProperty("bali.app")) { "bali.app is unset: run the tests through Gradle (android/README.md)" })
        val manifest =
            DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            }.newDocumentBuilder().parse(app.resolve("src/main/AndroidManifest.xml"))
        val build = app.resolve("build.gradle.kts").readText()

        fun elements(tag: String) = manifest.getElementsByTagName(tag).let { list -> (0 until list.length).map { list.item(it) as Element } }

        fun Element.android(name: String): String = getAttributeNS("http://schemas.android.com/apk/res/android", name)
        val named = elements("meta-data").associate { it.android("name") to it.android("value") }.filterKeys { it.startsWith("Bali") }
        assertEquals(AppConfig.Key.entries.map { it.key }.toSet(), named.keys)
        val made = Regex("""resValue\("string", "(\w+)", "([^"]*)"\)""").findAll(build).map { it.groupValues[1] to it.groupValues[2] }.toList()
        val built =
            named.mapValues { (key, value) ->
                val name = assertNotNull(Regex("@string/(\\w+)").matchEntire(value), "$key: $value").groupValues[1]
                val set = made.filter { it.first == name }
                assertEquals(1, set.size, "$name is set ${set.size} times in build.gradle.kts")
                set.single().second
            }
        assertEquals(named.values.map { it.removePrefix("@string/") }.toSet(), made.map { it.first }.filter { it.startsWith("BALI_") }.toSet())

        val clientId = built.getValue(AppConfig.Key.CognitoClientId.key)
        assertEquals(clientId.isEmpty(), AppConfig.from(built) == null)
        val config = assertNotNull(AppConfig.from(built + (AppConfig.Key.CognitoClientId.key to clientId.ifEmpty { "client" })))
        assertEquals(URI("com.bali.bali:/auth/callback"), config.cognito.redirectUri)
        assertEquals(listOf("https", "https", "https"), listOf(config.api.scheme, config.cognito.domain.scheme, config.portal.scheme))
        val id = assertNotNull(Regex("""applicationId = "([^"]+)"""").find(build)).groupValues[1]
        assertEquals(id, config.cognito.redirectUri.scheme)
        assertEquals(listOf(id), elements("data").map { it.android("scheme") })
    }
}
