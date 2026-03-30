#!/bin/bash
# Phantom Browser — Flatpak Build Script
# Creates the source archive and builds the Flatpak package

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIREFOX_SRC="${FIREFOX_SRC:-$HOME/mozilla-unified}"
DIST_DIR="$FIREFOX_SRC/obj-phantom/dist"
VERSION="151.0a1"
ARCHIVE_NAME="phantom-${VERSION}.tar.xz"

echo "=== Phantom Browser — Flatpak Build ==="
echo ""

# Step 1: Verify mach package output exists
if [ ! -d "$DIST_DIR/phantom" ]; then
    echo "ERROR: $DIST_DIR/phantom not found."
    echo "Run 'cd $FIREFOX_SRC && ./mach package' first."
    exit 1
fi

# Step 2: Prepare staging directory with extra icons
echo "[1/4] Preparing staging directory..."
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

cp -r "$DIST_DIR/phantom" "$STAGING/phantom"

# Add larger icons from branding (mach package only includes up to 128px)
for size in 256 512; do
    src="$PROJECT_DIR/branding/default${size}.png"
    if [ -f "$src" ]; then
        mkdir -p "$STAGING/phantom/browser/chrome/icons/default"
        cp "$src" "$STAGING/phantom/browser/chrome/icons/default/default${size}.png"
        echo "  Added ${size}px icon"
    fi
done

# Step 3: Create source archive
echo "[2/4] Creating archive..."
tar -C "$STAGING" -cJf "$SCRIPT_DIR/$ARCHIVE_NAME" phantom
echo "  Created $ARCHIVE_NAME ($(du -h "$SCRIPT_DIR/$ARCHIVE_NAME" | cut -f1))"

# Step 4: Validate all sources exist
echo "[3/4] Validating sources..."
MISSING=0
for f in "$ARCHIVE_NAME" phantom-browser.sh io.github.anthropic.PhantomBrowser.desktop io.github.anthropic.PhantomBrowser.metainfo.xml; do
    if [ ! -f "$SCRIPT_DIR/$f" ]; then
        echo "  MISSING: $f"
        MISSING=1
    else
        echo "  OK: $f"
    fi
done

if [ "$MISSING" -eq 1 ]; then
    echo "ERROR: Missing source files. Aborting."
    exit 1
fi

# Step 5: Build Flatpak
echo "[4/4] Building Flatpak..."
cd "$SCRIPT_DIR"

flatpak-builder --force-clean \
    --user \
    --install-deps-from=flathub \
    build-dir \
    io.github.anthropic.PhantomBrowser.yml

echo ""
echo "=== Flatpak build complete! ==="
echo ""
echo "Install locally:"
echo "  flatpak-builder --user --install --force-clean build-dir io.github.anthropic.PhantomBrowser.yml"
echo ""
echo "Export to repo:"
echo "  flatpak-builder --repo=repo --force-clean build-dir io.github.anthropic.PhantomBrowser.yml"
echo "  flatpak --user remote-add --no-gpg-verify phantom-repo repo"
echo "  flatpak --user install phantom-repo io.github.anthropic.PhantomBrowser"
