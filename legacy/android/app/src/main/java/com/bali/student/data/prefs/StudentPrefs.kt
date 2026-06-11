package com.bali.student.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.studentDataStore by preferencesDataStore(name = "student_prefs")

@Singleton
class StudentPrefs @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val setupCompleteKey = booleanPreferencesKey("setup_complete")

    val setupComplete: Flow<Boolean> = context.studentDataStore.data
        .map { it[setupCompleteKey] ?: false }

    suspend fun isSetupComplete(): Boolean = setupComplete.first()

    suspend fun setSetupComplete(value: Boolean) {
        context.studentDataStore.edit { it[setupCompleteKey] = value }
    }
}
