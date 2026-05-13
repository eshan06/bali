package com.bali.student.data.api

import com.bali.student.data.model.AcceptInviteResponse
import com.bali.student.data.model.SimulateCheckInResponse
import com.bali.student.data.model.StudentClassDetail
import com.bali.student.data.model.StudentSelf
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface BaliApi {
    @GET("students/me")
    suspend fun getStudentSelf(): StudentSelf

    @GET("students/me/classes/{classId}")
    suspend fun getClassDetail(@Path("classId") classId: String): StudentClassDetail

    @POST("invites/{inviteId}/accept")
    suspend fun acceptInvite(@Path("inviteId") inviteId: String): AcceptInviteResponse

    @POST("students/me/classes/{classId}/simulate-check-in")
    suspend fun simulateCheckIn(@Path("classId") classId: String): SimulateCheckInResponse
}
