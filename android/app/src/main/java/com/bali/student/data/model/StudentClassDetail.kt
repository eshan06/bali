package com.bali.student.data.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class StudentClassDetail(
    val `class`: ClassInfo,
    val attendance: AttendanceStats,
    val activeSession: ActiveSessionLite? = null,
    val recentSessions: List<RecentSession> = emptyList(),
    val device: Device? = null,
)

@JsonClass(generateAdapter = true)
data class ClassInfo(
    val id: String,
    val name: String,
    val period: String? = null,
    val teacherName: String,
    val schoolName: String? = null,
)

@JsonClass(generateAdapter = true)
data class AttendanceStats(
    val rate: Double,
    val total: Int,
    val present: Int,
    val late: Int,
    val absent: Int,
    val excused: Int = 0,
)

@JsonClass(generateAdapter = true)
data class RecentSession(
    val sessionId: String,
    val startedAt: String,
    val endedAt: String? = null,
    val status: String,
    val checkInAt: String? = null,
    val isOverride: Boolean = false,
    val blockingStatus: String? = null,
)

@JsonClass(generateAdapter = true)
data class Device(
    val deviceId: String,
    val friendlyName: String? = null,
)
