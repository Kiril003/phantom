// PHANTOM Companion — `:app` module.
//
// Tier 1 scope (per docs/MOBILE_COMPANION.md §3): pairing, profile sync,
// push-to-talk voice WS, sensor batch upload, glass-themed UI for the
// five tabs. Filament / MapLibre / SQLCipher land in Tier 2 modules.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "local.phantom.companion"
    // compileSdk 34 is the safe-but-modern choice on this Radxa host:
    // platform-35 build-tools landed too recently for the Ubuntu aapt2
    // override to be guaranteed-compatible. The app still runs on
    // Android 14 devices because target features used here are 34-stable.
    compileSdk = 34

    defaultConfig {
        applicationId = "local.phantom.companion"
        // minSdk 29 = Android 10. Picked for: BiometricPrompt class 3 stable,
        // EncryptedSharedPreferences, GPS background-location dance, foreground
        // service typing. RenderEffect blur (API 31) is opt-in via SDK_INT
        // checks inside `GlassCard`, so 29-30 devices fall back to a flat tint.
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-tier1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // Debug signing uses a deterministic keystore generated at first build
        // via `scripts/build_apk.sh` so the resulting APK is always installable
        // and even Gradle-less manual rebuilds (the original Day-19 fallback
        // path) sign with the same identity.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "phantom"
            keyAlias = "phantom"
            keyPassword = "phantom"
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            // Release config is wired but not used in Tier 1 — APK upload to
            // the phone is debug-built. R8 stays off until we have a tested
            // proguard-rules.pro covering Ktor + BouncyCastle reflection.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        // Compose stability + suppress deprecation noise from BouncyCastle 1.78
        // pulling JDK 8 helpers we don't actually invoke.
        freeCompilerArgs = freeCompilerArgs + listOf(
            "-opt-in=kotlin.RequiresOptIn",
            "-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi",
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/INDEX.LIST",
                "/META-INF/io.netty.versions.properties",
                "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
            )
        }
    }

    // The Radxa host has aarch64 native libs available via ABI filters
    // when we need JNI later (Filament). For Tier 1 every dep is pure
    // JVM bytecode, so no ABI split is needed.
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.biometric)

    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.logging)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.client.websockets)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.zxing.core)
    implementation(libs.bouncycastle)
}
