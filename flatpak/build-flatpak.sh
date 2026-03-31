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

# Add autoconfig files (mach package doesn't include them — they live in dist/bin/)
echo "  Adding autoconfig..."
cp "$PROJECT_DIR/phantom/phantom.cfg" "$STAGING/phantom/phantom.cfg"
mkdir -p "$STAGING/phantom/defaults/pref"
cp "$PROJECT_DIR/phantom/defaults/pref/autoconfig.js" "$STAGING/phantom/defaults/pref/autoconfig.js"

# Patch phantom JS modules inside browser/omni.ja with latest source
# (avoids full Firefox rebuild — omni.ja is a zip with chrome/ inside)
echo "  Patching omni.ja with latest phantom modules..."
OMNI="$STAGING/phantom/browser/omni.ja"
OMNI_TMP="$(mktemp -d)"
(cd "$OMNI_TMP" && unzip -qo "$OMNI")
cp "$PROJECT_DIR/phantom/dpi/dpi-engine.sys.mjs"  "$OMNI_TMP/chrome/browser/phantom/dpi/dpi-engine.sys.mjs"
cp "$PROJECT_DIR/phantom/dpi/dpi-hook.js"          "$OMNI_TMP/chrome/browser/phantom/dpi/dpi-hook.js"
cp "$PROJECT_DIR/phantom/dpi/dpi-proxy.sys.mjs"    "$OMNI_TMP/chrome/browser/phantom/dpi/dpi-proxy.sys.mjs"
cp "$PROJECT_DIR/phantom/vpn/vpn-engine.sys.mjs"   "$OMNI_TMP/chrome/browser/phantom/vpn/vpn-engine.sys.mjs"
cp "$PROJECT_DIR/phantom/vpn/vpn-hook.js"           "$OMNI_TMP/chrome/browser/phantom/vpn/vpn-hook.js"
cp "$PROJECT_DIR/phantom/blocker/blocker-engine.sys.mjs" "$OMNI_TMP/chrome/browser/phantom/blocker/blocker-engine.sys.mjs"
cp "$PROJECT_DIR/phantom/blocker/blocker-hook.js"   "$OMNI_TMP/chrome/browser/phantom/blocker/blocker-hook.js"
cp "$PROJECT_DIR/phantom/proxy/proxy-manager.sys.mjs" "$OMNI_TMP/chrome/browser/phantom/proxy/proxy-manager.sys.mjs"
cp "$PROJECT_DIR/phantom/proxy/proxy-hook.js"       "$OMNI_TMP/chrome/browser/phantom/proxy/proxy-hook.js"
cp "$PROJECT_DIR/phantom/phantom-loader.js"         "$OMNI_TMP/chrome/browser/phantom/phantom-loader.js"
cp "$PROJECT_DIR/phantom/diagnostics/diagnostics.sys.mjs" "$OMNI_TMP/chrome/browser/phantom/diagnostics/diagnostics.sys.mjs"
cp "$PROJECT_DIR/phantom/ai/ai-sidebar.js"          "$OMNI_TMP/chrome/browser/phantom/ai/ai-sidebar.js"
cp "$PROJECT_DIR/phantom/ai/ai-provider.sys.mjs"    "$OMNI_TMP/chrome/browser/phantom/ai/ai-provider.sys.mjs"
python3 -c "
import zipfile, os
omni = '$OMNI'
src = '$OMNI_TMP'
with zipfile.ZipFile(omni, 'w', zipfile.ZIP_STORED) as zf:
    for root, dirs, files in os.walk(src):
        for f in sorted(files):
            full = os.path.join(root, f)
            arc = os.path.relpath(full, src)
            zf.write(full, arc)
"
rm -rf "$OMNI_TMP"
echo "  omni.ja patched"

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

# Step 5: Build Flatpak + export to OSTree repo
echo "[4/4] Building Flatpak..."
cd "$SCRIPT_DIR"

REPO_DIR="$SCRIPT_DIR/../repo-flatpak"

flatpak-builder --force-clean \
    --user \
    --install-deps-from=flathub \
    --repo="$REPO_DIR" \
    build-dir \
    io.github.anthropic.PhantomBrowser.yml

# Generate static repo index (нужен для GitHub Pages)
flatpak build-update-repo \
    --generate-static-deltas \
    --default-branch=master \
    "$REPO_DIR"

echo ""
echo "=== Flatpak build complete! ==="
echo ""
echo "Локальная установка:"
echo "  flatpak --user remote-add --no-gpg-verify phantom $REPO_DIR"
echo "  flatpak --user install phantom io.github.anthropic.PhantomBrowser"
echo ""
echo "Публикация для пользователей:"
echo "  cd $REPO_DIR && git add -A && git commit -m 'release $VERSION' && git push"
echo ""
echo "Пользователи добавляют remote один раз:"
echo "  flatpak remote-add --user phantom https://SergBrowns.github.io/phantom-browser-repo/"
echo "  flatpak install --user phantom io.github.anthropic.PhantomBrowser"
echo ""
echo "Обновление у пользователей:"
echo "  flatpak update io.github.anthropic.PhantomBrowser"
