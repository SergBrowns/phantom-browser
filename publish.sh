#!/bin/bash
# Phantom Browser — Release Publisher
# Builds Flatpak, signs the OSTree repo, and pushes to GitHub Pages.
#
# Usage:
#   ./publish.sh [VERSION]
#
# Example:
#   ./publish.sh 151.0a1
#   ./publish.sh          # uses version from flatpak/build-flatpak.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLATPAK_DIR="$SCRIPT_DIR/flatpak"
REPO_DIR="$SCRIPT_DIR/repo-flatpak"
GPG_KEY="BE19E9A1EC50086E27C3EC389DD6DF07A31D15AE"

# --- Version ---
if [ -n "${1:-}" ]; then
    VERSION="$1"
else
    VERSION=$(grep '^VERSION=' "$FLATPAK_DIR/build-flatpak.sh" | cut -d'"' -f2)
fi

echo "=== Phantom Browser Release Publisher ==="
echo "Version : $VERSION"
echo "Repo    : $REPO_DIR"
echo ""

# --- GPG key sanity check ---
if ! gpg --list-secret-keys "$GPG_KEY" &>/dev/null; then
    echo "ERROR: GPG key $GPG_KEY not found."
    echo "Run this on the machine that has the signing key."
    exit 1
fi

# --- Step 1: Build Flatpak ---
echo "[1/3] Building Flatpak..."
cd "$FLATPAK_DIR"
bash build-flatpak.sh
echo ""

# --- Step 2: Sign OSTree repo ---
echo "[2/3] Signing OSTree repo..."
flatpak build-update-repo \
    --gpg-sign="$GPG_KEY" \
    --generate-static-deltas \
    --default-branch=master \
    "$REPO_DIR"
echo "  Repo signed."
echo ""

# --- Step 3: Commit and push repo-flatpak ---
echo "[3/3] Publishing to GitHub Pages..."
cd "$REPO_DIR"

git add -A
if git diff --cached --quiet; then
    echo "  No changes to publish."
else
    git commit -m "release: Phantom Browser $VERSION"
    echo "  Committed."
fi

git push origin master
echo "  Pushed to origin/master."
echo ""

echo "=== Published! ==="
echo ""
echo "GitHub Pages URL (after ~2 min propagation):"
echo "  https://SergBrowns.github.io/phantom-browser-repo/"
echo ""
echo "Users install via .flatpakref:"
echo "  flatpak install phantom-browser.flatpakref"
echo ""
echo "Or manually:"
echo "  flatpak remote-add --user phantom https://SergBrowns.github.io/phantom-browser-repo/"
echo "  flatpak install --user phantom io.github.anthropic.PhantomBrowser"
echo ""
echo "Users update:"
echo "  flatpak update io.github.anthropic.PhantomBrowser"
