package com.bali.student.data.api

import com.bali.student.data.model.StudentClassDetail
import com.bali.student.data.model.StudentSelf
import retrofit2.http.GET
import retrofit2.http.Path

interface BaliApi {
    @GET("students/me")
    suspend fun getStudentSelf(): StudentSelf

    @GET("students/me/classes/{classId}")
    suspend fun getClassDetail(@Path("classId") classId: String): StudentClassDetail
}
