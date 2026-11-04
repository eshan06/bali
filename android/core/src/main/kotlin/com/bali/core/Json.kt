package com.bali.core

import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.time.format.DateTimeParseException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.modules.SerializersModule
import kotlinx.serialization.modules.plus

/**
 * The coding of every request and response body, as BaliJSON and Swift's own Codable code them:
 * a field this build doesn't know is skipped; an optional field left out reads as none, and none
 * is left out when sent; every other field is sent. A time is an [Instant] marked `@Contextual`,
 * on the wire as JS `toISOString()` writes it, `2000-01-01T00:01:00.000Z`: read with or without
 * the milliseconds, sent with them, as the API does. Any JSON value, a field `@bali/shared` types
 * as `unknown` such as an error's `details`, is kotlinx's `JsonElement`, BaliCore's `JSONValue`.
 */
val BaliJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    serializersModule = SerializersModule { contextual(Instant::class, WireTime) }
}

/**
 * The contract tests' reading: a vocabulary value this build doesn't know fails the decode, where
 * [BaliJson] reads it as [OrUnknown.Unknown]. Its module carries the mark, so a copy stays strict.
 */
internal val StrictJson: Json = Json(from = BaliJson) {
    serializersModule = BaliJson.serializersModule +
        SerializersModule { contextual(StrictVocabulary::class, StrictVocabulary.serializer()) }
}

/** The mark of [StrictJson]'s module. */
@Serializable
internal object StrictVocabulary

/** True for a decoder of [StrictJson]'s: a vocabulary value this build doesn't know fails. */
internal val Decoder.strictVocabulary: Boolean
    get() = serializersModule.getContextual(StrictVocabulary::class) != null

/** A time on the wire: ISO 8601 in UTC, read with or without milliseconds, sent with them. */
internal object WireTime : KSerializer<Instant> {
    private val withMilliseconds = DateTimeFormatterBuilder().appendInstant(3).toFormatter()

    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("com.bali.core.WireTime", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(withMilliseconds.format(value))

    override fun deserialize(decoder: Decoder): Instant {
        val text = decoder.decodeString()
        return try {
            Instant.parse(text)
        } catch (error: DateTimeParseException) {
            throw SerializationException("Not an ISO 8601 time: $text", error)
        }
    }
}
