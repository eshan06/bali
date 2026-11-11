package com.bali.core

import java.io.IOException
import java.net.URI
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.KSerializer
import kotlinx.serialization.serializer

// The API client, BaliCore's APIClient.swift: one call per student endpoint, suspending as Swift's
// are async, each answering with an `ApiResponse`, the send result and body the outbox tables take,
// unjudged. It never retries, refreshes a token, deletes a record, mints an event id or decides what
// an answer means: the outbox and the sync engine do (AN4, AN5). No token or body is ever logged.

/** Where the client gets the bearer token every request carries: Cognito's access token (AN6). */
interface TokenProvider {
    /**
     * The token to send now, or none right now (offline with an expired one, a refresh under way,
     * nobody signed in yet): never a sign-out, nor a reason to drop a record. Nothing is sent then,
     * never earning a `401` nobody said: the answer is [NoAnswer.NoToken], which every outbox table
     * reads as retry. Nor is a token refreshed: a `401` comes back as a value, for the caller's reauth.
     * It never throws, nor ends on a cancel of its own, as Swift's type promises: a token it can't give
     * is none, since the sync engine's drain asks for one before every send it makes.
     */
    suspend fun accessToken(): String?

    /**
     * The token to send now for [account] alone, by its `sub` (the owner, 2026-11-10: "Close it now";
     * [ApiClient.forAccount]): [accessToken]'s while it is [account]'s, else none, so nothing is sent
     * ([NoAnswer.NoToken]): never another account's, nor any for none. A provider that renews its
     * tokens checks the account first, so none of another account's is renewed for it.
     */
    suspend fun accessToken(account: String?): String? = accessToken()?.takeIf { Tokens.isFor(it, account) }

    /**
     * The token an account deletion sends under (C4; [ApiClient.forDeletion]), [account]'s alone as
     * [accessToken] gives it, unless a provider gives this one where that gives none, as sign-in does
     * while it is not through the 13+ check (C7), so a sign-in answered under 13 deletes its account
     * as Delete account does, and the check's own read, which makes no account either, goes first.
     */
    suspend fun deletionToken(account: String?): String? = accessToken(account)
}

/** A provider's tokens for [account] alone: its deletion token, [deletion], else its access token. */
private class AccountTokens(private val tokens: TokenProvider, private val account: String?, private val deletion: Boolean) : TokenProvider {
    override suspend fun accessToken() = if (deletion) tokens.deletionToken(account) else tokens.accessToken(account)
}

/** Why a call has no answer: [SendResult.NetworkError], which every outbox table reads as retry. */
enum class NoAnswer {
    /** The token provider had none to give, so nothing was sent: not "can't reach the server". */
    NoToken,
    /** No HTTP answer came: offline, a timeout, a dropped connection; or, never in practice, an unbuildable request. */
    Unreachable,
}

/**
 * One call's answer, as the outbox tables take it: `tapDisposition(response.result,
 * response.answer)`. A refusal is a value like any other answer, never a thrown error, so nothing
 * is lost on the way to the table that decides the record's fate.
 */
@ConsistentCopyVisibility
data class ApiResponse<out A> internal constructor(
    /** The status the server answered with, or [SendResult.NetworkError] when no answer came. */
    val result: SendResult,
    /**
     * On a 2xx, the body decoded as the endpoint's answer, as the app decodes one; none on any other
     * status, or when it doesn't decode: no known outcome, so each table keeps the record.
     */
    val answer: A?,
    /**
     * On any other status, the one error shape, whose `reason` a screen keys on, never its message;
     * none on a 2xx, or when it doesn't decode (a proxy's own error page, say).
     */
    val error: ApiErrorBody?,
    /** Why no answer came, when [result] is [SendResult.NetworkError]; none when one did. */
    val noAnswer: NoAnswer?,
    /** The answer's `ETag`, if it carried one: what a poll sends back as `If-None-Match` (L5). */
    val etag: String?,
    /** A `429`'s `Retry-After` in whole seconds, as the API sends it; none when none came so. */
    val retryAfter: Int?,
)

/** One request as the client puts it on the wire, the token among its [headers]; [timeout], its wait for a next byte. */
class HttpRequest(
    val method: String,
    val url: URI,
    val headers: Map<String, String>,
    val body: ByteArray?,
    val timeout: Duration,
)

/** One HTTP answer: its status, its headers and its body. */
class HttpAnswer(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
    /** The header [name]'s value, its name read in any case, as HTTP reads one. */
    fun header(name: String): String? = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

/** How the client puts a request on the wire: [OkHttpTransport] in the app, a double in the tests. */
interface HttpTransport {
    /** [request]'s answer. Throws an [IOException] when no HTTP answer came. */
    suspend fun send(request: HttpRequest): HttpAnswer
}

/**
 * The student endpoints on the API at [baseUrl], its scheme, host and any path. Each call answers
 * with what the server said, sending its request once: whether to send it again is the outbox's to
 * decide. A cancelled caller stays cancelled, never answered: no table reads it, so its record stays.
 */
class ApiClient(
    val baseUrl: URI,
    private val tokens: TokenProvider,
    private val transport: HttpTransport = OkHttpTransport(),
    private val timeout: Duration = REQUEST_TIMEOUT,
) {
    /** This client under [account]'s token alone ([TokenProvider.accessToken]): what goes for one account, the 13+ check's yes. */
    fun forAccount(account: String?): ApiClient = ApiClient(baseUrl, AccountTokens(tokens, account, deletion = false), transport, timeout)

    /**
     * This client under [account]'s deletion token alone ([TokenProvider.deletionToken]): an account deletion's (C4),
     * and the 13+ check's read. Never under whoever is signed in: a deletion is always one account's.
     */
    fun forDeletion(account: String?): ApiClient = ApiClient(baseUrl, AccountTokens(tokens, account, deletion = true), transport, timeout)

    /** `GET /v1/me`: the boot call; a read of the truth, for `readMayReconcile`. */
    suspend fun me(): ApiResponse<MeResponse> = read("/v1/me")

    /** `PATCH /v1/me`: the student sets their own display name. */
    suspend fun updateMe(request: UpdateMeRequest): ApiResponse<UpdateMeResponse> = send("PATCH", "/v1/me", request)

    /** `DELETE /v1/me`: the caller deletes their own account (C3). */
    suspend fun deleteMe(request: DeleteMeRequest): ApiResponse<DeleteMeResponse> = send("DELETE", "/v1/me", request)

    /** `GET /v1/me/age-check`: whether this account passed the 13+ check (C7-server); it makes no account. */
    suspend fun ageCheck(): ApiResponse<AgeCheckResponse> = read("/v1/me/age-check")

    /** `PUT /v1/me/age-check`: this account's yes to the 13+ check, recorded (C7-server). */
    suspend fun recordAgeCheck(request: RecordAgeCheckRequest): ApiResponse<AgeCheckResponse> =
        send("PUT", "/v1/me/age-check", request)

    /** `PUT /v1/me/push-token`: the student registers its phone's push token (N3). */
    suspend fun registerPushToken(request: RegisterPushTokenRequest): ApiResponse<RegisterPushTokenResponse> =
        send("PUT", "/v1/me/push-token", request)

    /** `DELETE /v1/me/push-token`: the student removes its phone's push token (N3). */
    suspend fun removePushToken(request: RemovePushTokenRequest): ApiResponse<RemovePushTokenResponse> =
        send("DELETE", "/v1/me/push-token", request)

    /** `POST /v1/taps`: for `tapDisposition`. */
    suspend fun tap(request: TapRequest): ApiResponse<TapResponse> = send("POST", "/v1/taps", request)

    /** `POST /v1/sessions/{id}/checkin`: a read of the truth, for `readMayReconcile`. */
    suspend fun checkIn(session: String, request: CheckInRequest): ApiResponse<CheckInResponse> =
        send("POST", "/v1/sessions/${escaped(session)}/checkin", request)

    /** `POST /v1/sessions/{id}/unlock`: for `unlockDisposition`. */
    suspend fun unlock(session: String, request: UnlockRequest): ApiResponse<UnlockResponse> =
        send("POST", "/v1/sessions/${escaped(session)}/unlock", request)

    /**
     * `POST /v1/taps/{eventId}/unlock`: an unlock made while the phone's own tap is unanswered, under
     * that tap's event id (owner decision 11), filed by the server wherever the tap landed, or kept
     * with no session. For `unlockDisposition`, as any unlock.
     */
    suspend fun unlockUnderTap(tap: String, request: UnlockRequest): ApiResponse<UnlockResponse> =
        send("POST", "/v1/taps/${escaped(tap)}/unlock", request)

    /** `PATCH /v1/unlocks/{eventId}`: an unlock's reason changed (A20), by the Unlocked screen, not an outbox. */
    suspend fun changeReason(unlock: String, request: UnlockReasonRequest): ApiResponse<UnlockReasonResponse> =
        send("PATCH", "/v1/unlocks/${escaped(unlock)}", request)

    /** `POST /v1/sessions/{id}/refocus`: for `stateChangeDisposition`. */
    suspend fun refocus(session: String, request: RefocusRequest): ApiResponse<RefocusResponse> =
        send("POST", "/v1/sessions/${escaped(session)}/refocus", request)

    /** `POST /v1/sessions/{id}/protection-off`: for `stateChangeDisposition`. */
    suspend fun protectionOff(session: String, request: ProtectionOffRequest): ApiResponse<ProtectionOffResponse> =
        send("POST", "/v1/sessions/${escaped(session)}/protection-off", request)

    /** `POST /v1/sessions/{id}/protection-on`: the lock back on (#167), for `stateChangeDisposition`. */
    suspend fun protectionOn(session: String, request: ProtectionOnRequest): ApiResponse<ProtectionOnResponse> =
        send("POST", "/v1/sessions/${escaped(session)}/protection-on", request)

    /** `POST /v1/enrollments`: join a class by its code. */
    suspend fun join(request: EnrollmentJoinRequest): ApiResponse<EnrollmentJoinResponse> =
        send("POST", "/v1/enrollments", request)

    /** `DELETE /v1/enrollments/{id}`: leave a class, never while it is in session (A19). */
    suspend fun leave(enrollment: String, request: EndEnrollmentRequest): ApiResponse<EndEnrollmentResponse> =
        send("DELETE", "/v1/enrollments/${escaped(enrollment)}", request)

    /**
     * `GET /v1/join-codes/{code}`: what a code opens, before joining it. The code goes as typed: the
     * server reads case and surrounding whitespace as noise, as the join does.
     */
    suspend fun previewJoinCode(code: String): ApiResponse<JoinCodePreviewResponse> =
        read("/v1/join-codes/${escaped(code)}")

    /**
     * `GET /v1/me/history`: a page of the student's own history, newest first: the moments before
     * [before] (the last page's `nextBefore`), at most [limit]; none for the server's defaults.
     */
    suspend fun history(before: String? = null, limit: Int? = null): ApiResponse<HistoryPage> {
        val query = listOfNotNull(limit?.let { "limit=$it" }, before?.let { "before=${escaped(it)}" }).joinToString("&")
        return read("/v1/me/history" + if (query.isEmpty()) "" else "?$query")
    }

    /**
     * `GET /v1/sessions/{id}/presentation`: a live lesson as the phone shows it (Phase 7, L4), a `304`
     * with no body while it is the one the last answer's `ETag`, [ifNoneMatch], names (L5).
     */
    suspend fun presentation(session: String, ifNoneMatch: String? = null): ApiResponse<Presentation> =
        read("/v1/sessions/${escaped(session)}/presentation", ifNoneMatch)

    /** `GET /v1/decks/{id}/download`: a presigned GET of the deck a slide names (Phase 7, M3b). */
    suspend fun download(deck: String): ApiResponse<DeckDownload> = read("/v1/decks/${escaped(deck)}/download")

    /** `POST /v1/questions/{id}/answers`: the student's answer, sent once: no outbox table reads it. */
    suspend fun answer(question: String, request: AnswerRequest): ApiResponse<AnswerResponse> =
        send("POST", "/v1/questions/${escaped(question)}/answers", request)

    private suspend inline fun <reified A> read(path: String, ifNoneMatch: String? = null): ApiResponse<A> =
        exchange(serializer<A>(), "GET", path, null, ifNoneMatch)

    private suspend inline fun <reified A, reified B> send(method: String, path: String, body: B): ApiResponse<A> =
        exchange(serializer<A>(), method, path, { BaliJson.encodeToString(serializer<B>(), body) })

    /** One request, sent once, and its answer as the tables take it. */
    private suspend fun <A> exchange(
        answer: KSerializer<A>, method: String, path: String, body: (() -> String)?, ifNoneMatch: String? = null,
    ): ApiResponse<A> {
        val token = tokens.accessToken()
        if (token.isNullOrEmpty()) return noAnswer(NoAnswer.NoToken)
        // Neither the URL nor the body can fail (`path` is ASCII the client escaped; every body is
        // strings, times and closed vocabularies); were either to, nothing is sent, the record kept.
        val request =
            try {
                val data = body?.invoke()?.encodeToByteArray()
                val headers = mutableMapOf("Authorization" to "Bearer $token")
                if (ifNoneMatch != null) headers["If-None-Match"] = ifNoneMatch
                // Only with a body: Fastify refuses a JSON type on an empty one, a DELETE's, with a 400.
                if (data != null) headers["Content-Type"] = "application/json"
                HttpRequest(method, URI.create(baseUrl.toString().trimEnd('/') + path), headers, data, timeout)
            } catch (error: IllegalArgumentException) { return noAnswer(NoAnswer.Unreachable) }
        val reply = try { transport.send(request) } catch (error: IOException) { return noAnswer(NoAnswer.Unreachable) }
        // A body is read only as its status's: a 2xx's as the answer, any other's as the error.
        val ok = reply.status in 200..299
        return ApiResponse(
            result = SendResult.Status(reply.status),
            answer = if (ok) decoded(answer, reply.body) else null,
            error = if (ok) null else decoded(ApiErrorBody.serializer(), reply.body),
            noAnswer = null,
            etag = reply.header("ETag"),
            retryAfter = reply.header("Retry-After")?.toIntOrNull(),
        )
    }

    companion object {
        /**
         * How long a request may wait for its next byte: well inside the 30-second check-in, and
         * long enough for a school's Wi-Fi at the bell. A timeout is no answer, retried: a request
         * the server did record goes again under its event id and is answered as a replay.
         */
        val REQUEST_TIMEOUT: Duration = 15.seconds
    }
}

private fun <A> noAnswer(why: NoAnswer) = ApiResponse<A>(SendResult.NetworkError, null, null, why, null, null)

/** [body] read as [type], as the app decodes an answer; none when it isn't one, or isn't UTF-8. */
private fun <T> decoded(type: KSerializer<T>, body: ByteArray): T? =
    try {
        BaliJson.decodeFromString(type, body.decodeToString(throwOnInvalidSequence = true))
    } catch (error: Exception) { // kotlinx's SerializationException, or a CharacterCodingException
        null
    }

/**
 * [value] as one path segment or query value: every byte but an ASCII letter or digit, `-`, `_` or
 * `~` percent-encoded, so nothing a student types (a space, a `/`, a `?`, a `..`) changes the URL.
 */
internal fun escaped(value: String): String =
    value.encodeToByteArray().joinToString("") { byte ->
        val code = byte.toInt() and 0xFF
        val char = code.toChar()
        if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char in "-_~") "$char"
        else "%${HEX[code shr 4]}${HEX[code and 15]}"
    }

private const val HEX = "0123456789ABCDEF"
