// PHANTOM Companion — Gradle settings.
//
// Phase 19 Tier 1 ships a single `:app` module. The design doc envisages
// a multi-module split (core-design / core-net / core-data / feature-*),
// but for the first compilable APK we keep everything in one module so the
// build graph fits the Radxa aarch64 host without timing out.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "phantom-companion"
include(":app")
