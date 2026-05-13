package com.bali.student.data.focus

import com.squareup.moshi.JsonClass

/**
 * The active Focus Mode for the signed-in student. Sourced from the
 * server's blocking snapshot at check-in time and persisted locally so
 * the accessibility-service blocker can consult it offline.
 */
@JsonClass(generateAdapter = true)
data class FocusModePolicy(
    val sessionId: String,
    val classId: String,
    val className: String,
    val checkInTime: String,
    val attendanceStatus: String, // "present" | "late"
    val blockingActive: Boolean,
    val preset: String,
    val mode: String,             // "block_specific" | "block_all_except"
    val blockedPackages: List<String>,
    val allowedPackages: List<String>,
    val blockedAppNames: List<String>,
    val allowedAppNames: List<String>,
    val lastKnownStatus: String = STATUS_UNKNOWN,
    val activatedAt: Long = System.currentTimeMillis(),
) {
    companion object {
        const val STATUS_APPLIED = "applied"
        const val STATUS_FAILED = "failed"
        const val STATUS_DISABLED = "disabled"
        const val STATUS_UNKNOWN = "unknown"
    }
}
