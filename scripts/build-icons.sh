#!/usr/bin/env bash
# Regenerate the Tauri desktop-shell icons referenced by
# src/frontend/src-tauri/tauri.conf.json (bundle.icon).
#
# ─────────────────────────────────────────────────────────────────────────────
# THESE ARE PLACEHOLDERS, NOT PHANTOM BRANDING.
#
# The repository contains no product mark. tauri.conf.json has always pointed at
# icons/32x32.png, icons/128x128.png, icons/icon.ico and icons/icon.icns, none of
# which were ever committed, so `cargo build` of the shell failed on a clean
# clone with `failed to open icon .../icons/32x32.png`. The desktop app could
# not be packaged by anyone.
#
# The geometry below (a teal disc on near-black) was invented to unblock that
# build. It carries no design intent and must be replaced by the real mark.
# It lives in a script rather than as a committed source image so that no binary
# in this tree is a thing "nobody knows where it came from" — this file is the
# source, and the PNG/ICO/ICNS beside the config are its output.
#
# Usage: scripts/build-icons.sh          (requires ImageMagick 7 `magick`)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS="${ROOT}/src/frontend/src-tauri/icons"

if ! command -v magick >/dev/null 2>&1; then
  echo "build-icons: ImageMagick 7 (\`magick\`) is required" >&2
  exit 1
fi

mkdir -p "${ICONS}"
SRC="${ICONS}/icon-src.png"

magick -size 512x512 xc:'#0b0f14' \
  -fill '#4fd1c5' -draw 'circle 256,256 256,96' \
  -alpha set "${SRC}"

# Tauri embeds the window icon from the PNGs and rejects 16-bit channels, so
# pin 8-bit RGBA explicitly rather than trusting ImageMagick's default depth.
for size in 32 128; do
  magick "${SRC}" -resize "${size}x${size}" -depth 8 \
    -define png:color-type=6 "PNG32:${ICONS}/${size}x${size}.png"
done

magick "${SRC}" -resize 256x256 \
  -define icon:auto-resize=256,128,64,48,32,16 "${ICONS}/icon.ico"
magick "${SRC}" -resize 256x256 "${ICONS}/icon.icns"

echo "build-icons: wrote placeholder icons to ${ICONS}"
ls -1 "${ICONS}"
