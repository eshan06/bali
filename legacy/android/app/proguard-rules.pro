# Keep Moshi-generated adapters reachable via reflection.
-keep class com.squareup.moshi.** { *; }
-keep @com.squareup.moshi.JsonClass class *
-keep class **JsonAdapter { *; }

# Keep Retrofit service interfaces.
-keep interface com.bali.student.data.api.** { *; }

# Amplify uses reflection internally.
-keep class com.amplifyframework.** { *; }
