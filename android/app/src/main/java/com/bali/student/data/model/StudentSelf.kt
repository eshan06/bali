package com.bali.student.data.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class StudentSelf(
    val student: Student,
    val classes: List<StudentClassSummary>,
    val pendingInvites: List<PendingInvite> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class Student(
    val id: String,
    val firstName: String? = null,
    val lastName: String? = null,
    val email: String,
    val grade: String? = null,
)

@JsonClass(generateAdapter = true)
data class StudentClassSummary(
    val id: String,
    val name: String,
    val period: String? = null,
    val teacherName: String,
    val schoolName: String? = null,
    val activeSession: ActiveSessionLite? = null,
    val attendanceRate: Double = 0.0,
    val totalSessions: Int = 0,
)

@JsonClass(generateAdapter = true)
data class ActiveSessionLite(
    val id: String,
    val startedAt: String,
    val blockingEnabled: Boolean,
    val checkedIn: Boolean,
    val attendanceStatus: String? = null,
)

@JsonClass(generateAdapter = true)
data class AcceptInviteResponse(
    val studentId: String,
    val classId: String,
)

@JsonClass(generateAdapter = true)
data class PendingInvite(
    val inviteId: String,
    val classId: String,
    val className: String,
    val period: String? = null,
    val teacherName: String,
    val schoolName: String? = null,
    val invitedAt: String,
)
