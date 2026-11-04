package com.bali.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonElement

/**
 * The body of every non-2xx answer, `ApiErrorBody` in packages/shared/src/errors.ts: one shape,
 * so every screen can say something honest. `message` is safe to show.
 */
@Serializable
data class ApiErrorBody(val error: ApiError) {
    @Serializable
    data class ApiError(
        val code: OrUnknown<ApiErrorCode>,
        /**
         * Which refusal this is, where [code] alone doesn't say: the app keys on it, never on
         * [message]. A value this build doesn't know reads as none: a newer server may send one.
         */
        @Serializable(with = ReasonOrNone::class)
        val reason: ApiErrorReason? = null,
        val message: String,
        val details: JsonElement? = null,
    )
}

/** An error's reason read as [ApiErrorBody.ApiError.reason] says: one this build doesn't know as none. */
internal object ReasonOrNone : KSerializer<ApiErrorReason?> {
    private val sent = OrUnknownSerializer(ApiErrorReason.serializer()).nullable

    override val descriptor = sent.descriptor

    override fun serialize(encoder: Encoder, value: ApiErrorReason?) =
        encoder.encodeSerializableValue(sent, value?.let { OrUnknown.Known(it) })

    override fun deserialize(decoder: Decoder): ApiErrorReason? = decoder.decodeSerializableValue(sent)?.known
}
