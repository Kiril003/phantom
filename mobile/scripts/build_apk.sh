#!/usr/bin/env bash
# PHANTOM Companion — repeatable APK build entrypoint.
#
# Designed for the Radxa aarch64 host where Google's bundled aapt2 is
# x86_64-only; we lean on Ubuntu's `android-sdk-build-tools` package to
# supply an aarch64-native aapt2 (path baked into gradle.properties).
#
# Usage:  ./scripts/build_apk.sh           # debug APK
#         ./scripts/build_apk.sh release   # unsigned release APK (signing
#                                          # is up to the operator — debug
#                                          # keystore is acceptable for LAN
#                                          # sideloading)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${ANDROID_HOME:=/home/radxa/android-sdk}"
: "${JAVA_HOME:=/usr/lib/jvm/java-17-openjdk-arm64}"
: "${GRADLE_BIN:=/home/radxa/gradle-8.10.2/bin/gradle}"

export ANDROID_HOME JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

target="${1:-debug}"
case "$target" in
  debug)   task=assembleDebug   ;;
  release) task=assembleRelease ;;
  *)
    echo "unknown target: $target (expected debug|release)" >&2
    exit 64
    ;;
esac

# Generate the debug keystore if it's missing — repo ships without one so
# every operator gets their own self-signed identity.
if [[ "$target" == "debug" && ! -f "$ROOT/app/debug.keystore" ]]; then
  keytool -genkeypair \
    -keystore "$ROOT/app/debug.keystore" \
    -alias phantom -storepass phantom -keypass phantom \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=PHANTOM Companion Debug, OU=Mobile, O=PhantomOS, L=Kyiv, ST=Kyiv, C=UA"
fi

"$GRADLE_BIN" "$task" --stacktrace
echo
echo "APK ready:"
find "$ROOT/app/build/outputs/apk" -name '*.apk' -print
