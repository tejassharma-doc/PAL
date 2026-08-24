# ProGuard / R8 rules for PAL Health Android release build.
# These rules tell the minifier which classes must NOT be obfuscated or removed.

# ── React Native ──────────────────────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**

# ── React Native Gesture Handler ──────────────────────────────────────────────
-keep class com.swmansion.gesturehandler.** { *; }

# ── AsyncStorage ──────────────────────────────────────────────────────────────
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# ── Document Picker ───────────────────────────────────────────────────────────
-keep class com.reactnativedocumentpicker.** { *; }

# ── Image Picker ──────────────────────────────────────────────────────────────
-keep class com.imagepicker.** { *; }

# ── Kotlin ────────────────────────────────────────────────────────────────────
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# ── Keep model classes (serialized to/from JSON) ──────────────────────────────
# Adjust the package path if you add local Kotlin data classes later.
-keepclassmembers class com.palhealth.** { *; }

# ── General Android ──────────────────────────────────────────────────────────
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
