package com.bali.student.data.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class StudentClassDetail(
    val `class`: ClassInfo,
    val attendance: AttendanceStats,
    val activeSession: StudentActiveSessionInfo? = null,
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
data class StudentActiveSessionInfo(
    val id: String,
    val startedAt: String,
    val blockingEnabled: Boolean,
    val checkedIn: Boolean,
    val attendanceStatus: String? = null,
    val checkInAt: String? = null,
    val blockingSnapshot: BlockingSnapshot? = null,
    val deviceBlockingStatus: DeviceBlockingStatus? = null,
)

@JsonClass(generateAdapter = true)
data class BlockingSnapshot(
    val preset: String,
    val mode: String,
    val blockingActive: Boolean,
    val blockedApps: List<BlockingAppEntry> = emptyList(),
    val allowedApps: List<BlockingAppEntry> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class BlockingAppEntry(
    val bundleId: String,
    val appName: String,
)

@JsonClass(generateAdapter = true)
data class DeviceBlockingStatus(
    val isBlocked: Boolean,
    val reportedAt: String,
    val reportedBy: String,
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

@JsonClass(generateAdapter = true)
data class SimulateCheckInResponse(
    val success: Boolean,
    val sessionId: String,
    val classId: String,
    val attendanceStatus: String,
    val checkInTime: String,
    val blockingPolicy: BlockingSnapshot? = null,
)
