#!/bin/bash
# Phantom Browser — Build Script
# Prerequisites: Firefox source tree, Rust, clang

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIREFOX_SRC="${FIREFOX_SRC:-$HOME/mozilla-unified}"
FIREFOX_SRC="${FIREFOX_SRC/#\~/$HOME}"

echo "=== Phantom Browser Build ==="
echo "Firefox source: $FIREFOX_SRC"
echo ""

# Step 1: Apply patches
echo "[1/4] Applying patches..."
bash "$SCRIPT_DIR/patches/apply.sh" "$FIREFOX_SRC"

# Step 2: Copy Phantom modules into source tree
echo "[2/4] Copying Phantom modules..."
PHANTOM_DEST="$FIREFOX_SRC/browser/components/phantom"
rm -rf "$PHANTOM_DEST"
cp -r "$SCRIPT_DIR/phantom" "$PHANTOM_DEST"

# Register phantom in browser/components/moz.build
COMPONENTS_MOZBUILD="$FIREFOX_SRC/browser/components/moz.build"
if ! grep -q '"phantom"' "$COMPONENTS_MOZBUILD"; then
    sed -i 's/DIRS += \[$/DIRS += [\n    "phantom",/' "$COMPONENTS_MOZBUILD"
fi

# Step 3: Copy branding
echo "[3/4] Copying branding..."
BRANDING_DEST="$FIREFOX_SRC/browser/branding/phantom"
rm -rf "$BRANDING_DEST"
cp -r "$SCRIPT_DIR/branding" "$BRANDING_DEST"

# Step 4: Copy mozconfig
cp "$SCRIPT_DIR/mozconfig" "$FIREFOX_SRC/mozconfig"

# Step 5: Copy autoconfig files to dist
echo "[4/4] Setting up autoconfig..."
DIST_DIR="$FIREFOX_SRC/obj-phantom/dist/bin"
mkdir -p "$DIST_DIR/defaults/pref"
cp "$SCRIPT_DIR/phantom/phantom.cfg" "$DIST_DIR/phantom.cfg"
cp "$SCRIPT_DIR/phantom/defaults/pref/autoconfig.js" "$DIST_DIR/defaults/pref/autoconfig.js"

# Build
echo ""
echo "=== Starting build ==="
cd "$FIREFOX_SRC"
./mach build

echo ""
echo "=== Build complete! ==="
echo "Run with: ./mach run"
echo "Package with: ./mach package"
