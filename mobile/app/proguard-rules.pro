# PHANTOM Companion proguard rules.
# Tier 1 ships with R8 disabled (see app/build.gradle.kts), so these rules
# only matter once we flip the release build to minify. Captured early so
# the rule set evolves alongside the dependencies we add.

# Ktor uses java.lang.invoke + reflection on its serialization plugins.
-keep class io.ktor.** { *; }
-keep class kotlinx.serialization.** { *; }
-keepattributes *Annotation*, InnerClasses

# BouncyCastle reflection-discovered SPIs.
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Compose runtime relies on names being preserved for tooling-friendly traces.
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**

# kotlinx.coroutines's debug agent.
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**
