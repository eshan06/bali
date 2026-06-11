package com.bali.student.data.api

import com.bali.student.data.model.AcceptInviteResponse
import com.bali.student.data.model.ClassJoinPreview
import com.bali.student.data.model.JoinClassResponse
import com.bali.student.data.model.SimulateCheckInResponse
import com.bali.student.data.model.StudentClassDetail
import com.bali.student.data.model.StudentProfileUpdate
import com.bali.student.data.model.StudentSelf
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface BaliApi {
    @GET("students/me")
    suspend fun getStudentSelf(): StudentSelf

    @POST("students/me")
    suspend fun updateStudentProfile(@Body body: StudentProfileUpdate): StudentSelf

    @GET("students/me/classes/{classId}")
    suspend fun getClassDetail(@Path("classId") classId: String): StudentClassDetail

    @POST("invites/{inviteId}/accept")
    suspend fun acceptInvite(@Path("inviteId") inviteId: String): AcceptInviteResponse

    @POST("students/me/classes/{classId}/simulate-check-in")
    suspend fun simulateCheckIn(@Path("classId") classId: String): SimulateCheckInResponse

    @GET("classes/{classId}/preview")
    suspend fun getClassPreview(@Path("classId") classId: String): ClassJoinPreview

    @POST("classes/{classId}/join")
    suspend fun joinClass(@Path("classId") classId: String): JoinClassResponse
}
