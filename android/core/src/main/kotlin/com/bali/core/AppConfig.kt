package com.bali.core

import java.net.URI
import java.net.URISyntaxException

/**
 * Where the app signs in and syncs, as its build sets it (B4c), and the portal it links (C2b):
 * public values, no secret. Read here rather than in the app, so a test can pin these keys to
 * where the build sets them (#84's review), as BaliCore's pins iOS's Info.plist to `project.yml`:
 * a key misspelt on either side would otherwise build green and only say "not set up" on a phone.
 * Android's build sets them with sign-in's app side (AN6c). BaliCore's `AppConfig`.
 */
data class AppConfig(val api: URI, val cognito: Cognito, val portal: URI) {
    /** The keys, iOS's Info.plist keys, [key] each one's spelling. */
    enum class Key(val key: String) {
        Api("BaliAPIURL"),
        CognitoDomain("BaliCognitoDomain"),
        CognitoClientId("BaliCognitoClientID"),
        CognitoRedirectUri("BaliCognitoRedirectURI"),

        /** The portal whose privacy policy and terms the app links (C2b). */
        Portal("BaliPortalURL"),
    }

    companion object {
        /**
         * The build's, from [info], its values by [Key]; none while one isn't set: missing, empty,
         * or not a URL where one is wanted (what `java.net.URI` can't read).
         */
        fun from(info: Map<String, *>): AppConfig? {
            fun value(key: Key): String? = (info[key.key] as? String)?.ifEmpty { null }

            fun url(key: Key): URI? =
                value(key)?.let {
                    try {
                        URI(it)
                    } catch (error: URISyntaxException) {
                        null
                    }
                }
            return AppConfig(
                api = url(Key.Api) ?: return null,
                cognito =
                    Cognito(
                        domain = url(Key.CognitoDomain) ?: return null,
                        clientId = value(Key.CognitoClientId) ?: return null,
                        redirectUri = url(Key.CognitoRedirectUri) ?: return null,
                    ),
                portal = url(Key.Portal) ?: return null,
            )
        }
    }
}
