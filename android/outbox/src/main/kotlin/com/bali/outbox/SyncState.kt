package com.bali.outbox

import java.time.Instant

// What the sync engine knows, SyncEngine.swift's `SyncState`: its core, AN5a's. Each later AN5 step
// adds the fields its own rules keep (docs/PLAN-ANDROID.md).

/**
 * What the engine knows, for the screens and the lock ([SyncEngine.updates]). A value, as Swift's
 * struct is: each change is a copy, so a state a screen holds never moves under it.
 */
data class SyncState(
    /**
     * The server's truth as last reconciled, with the phone's own changes over it; [Standing.Unread]
     * while the file hasn't given back where the phone stood.
     */
    val standing: Standing = Standing.Out,
    /** Every record queued, in the order the phone acted: a stuck one is shown with its last answer (rule 5). */
    val queued: List<OutboxRecord> = emptyList(),
    /**
     * How the last exchange went, none before the first, and when the server last answered, so a
     * screen says how old its truth is instead of pretending.
     */
    val link: Link? = null,
    val heardAt: Instant? = null,
    /** When the outbox sends next; none when nothing is queued or it waits on a ring. */
    val retryAt: Instant? = null,
    /**
     * The session protection off was last reported in, since the phone's last tap or the lock back on
     * (`Outbox.reportedOff`): only those leave it there (A2; #167).
     */
    val reportedOff: String? = null,
    /**
     * The phone's newest tap, as the outbox's file keeps it: a refused tap is said only while it is
     * this one (#146). None: the file names none.
     */
    val lastTap: String? = null,
    /**
     * The records on their way, sent and not settled, or answered in a write the file refused, which
     * the file still counts as never sent: a reason given now wouldn't go with them (santa's review),
     * so the card offers none (C5c).
     */
    val sending: Set<String> = emptySet(),
) {
    /** A tap the server hasn't answered yet: the lock covers apps for it at once, to decision 7's cap (B5). */
    val pendingTap: OutboxRecord? get() = queued.lastOrNull { it.change is Change.Tap && !it.stuck }

    /** Whether an unlock made where the phone stood unread waits to be filed (B6b). */
    internal val holdsUnfiled: Boolean get() = queued.any { it.change.isUnfiled }
}

/** How the last exchange went. */
enum class Link {
    /** The server answered. */
    Reached,

    /** No answer came: "can't reach the server", with a retry. */
    Unreachable,

    /**
     * No token to send, or the server refused the one sent: waiting on sign-in (B4). Never a sign-out,
     * and nothing is dropped for it.
     */
    SignIn,

    /** The outbox couldn't be read or written; tried again within a minute. */
    StorageFailed,
}
