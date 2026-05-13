package com.bali.student.data.focus

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.squareup.moshi.Moshi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.focusDataStore by preferencesDataStore(name = "focus_mode")

@Singleton
class FocusModeStore @Inject constructor(
    @ApplicationContext private val context: Context,
    moshi: Moshi,
) {
    private val key = stringPreferencesKey("policy")
    private val adapter = moshi.adapter(FocusModePolicy::class.java)

    val policy: Flow<FocusModePolicy?> = context.focusDataStore.data.map { prefs ->
        prefs[key]?.let { raw ->
            runCatching { adapter.fromJson(raw) }.getOrNull()
        }
    }

    suspend fun current(): FocusModePolicy? = policy.first()

    suspend fun save(policy: FocusModePolicy) {
        context.focusDataStore.edit { it[key] = adapter.toJson(policy) }
    }

    suspend fun clear() {
        context.focusDataStore.edit { it.remove(key) }
    }

    suspend fun updateStatus(status: String) {
        val now = current() ?: return
        if (now.lastKnownStatus == status) return
        save(now.copy(lastKnownStatus = status))
    }
}
