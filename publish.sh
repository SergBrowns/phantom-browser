#!/bin/bash
# Phantom Browser — Release Publisher
# Bumps version in all files, builds Flatpak, signs the OSTree repo,
# and pushes to GitHub Pages.
#
# Usage:
#   ./publish.sh <NEW_VERSION> [CHANGELOG...]
#
# Examples:
#   ./publish.sh 152.0
#   ./publish.sh 152.0 "Fix DPI bypass on new ISP patterns" "Update VPN engine"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLATPAK_DIR="$SCRIPT_DIR/flatpak"
REPO_DIR="$SCRIPT_DIR/repo-flatpak"
GPG_KEY="BE19E9A1EC50086E27C3EC389DD6DF07A31D15AE"

BUILD_SH="$FLATPAK_DIR/build-flatpak.sh"
MANIFEST="$FLATPAK_DIR/io.github.anthropic.PhantomBrowser.yml"
METAINFO="$FLATPAK_DIR/io.github.anthropic.PhantomBrowser.metainfo.xml"

# --- Args ---
if [ -z "${1:-}" ]; then
    echo "Usage: ./publish.sh <VERSION> [changelog lines...]"
    echo "Example: ./publish.sh 152.0 'Fix DPI bypass' 'Update blocker rules'"
    exit 1
fi

NEW_VERSION="$1"
shift
CHANGELOG_ARGS=("$@")

OLD_VERSION=$(grep '^VERSION=' "$BUILD_SH" | cut -d'"' -f2)
TODAY=$(date +%Y-%m-%d)

echo "=== Phantom Browser Release Publisher ==="
echo "Version : $OLD_VERSION → $NEW_VERSION"
echo "Date    : $TODAY"
echo ""

if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo "WARNING: version unchanged ($NEW_VERSION). Continuing anyway..."
    echo ""
fi

# --- GPG key sanity check ---
if ! gpg --list-secret-keys "$GPG_KEY" &>/dev/null; then
    echo "ERROR: GPG key $GPG_KEY not found."
    echo "Run this on the machine that has the signing key."
    exit 1
fi

# --- Step 1: Bump version in source files ---
echo "[1/4] Bumping version..."

# build-flatpak.sh
sed -i "s/^VERSION=.*/VERSION=\"$NEW_VERSION\"/" "$BUILD_SH"
echo "  build-flatpak.sh: VERSION=$NEW_VERSION"

# manifest: archive path
sed -i "s|phantom-${OLD_VERSION}\.tar\.xz|phantom-${NEW_VERSION}.tar.xz|g" "$MANIFEST"
echo "  io.github.anthropic.PhantomBrowser.yml: archive updated"

# metainfo.xml: prepend new <release> entry inside <releases>
if [ ${#CHANGELOG_ARGS[@]} -gt 0 ]; then
    ITEMS=""
    for line in "${CHANGELOG_ARGS[@]}"; do
        ITEMS="$ITEMS          <li>$line</li>\n"
    done
    NEW_RELEASE="    <release version=\"$NEW_VERSION\" date=\"$TODAY\">\n      <description>\n        <ul>\n$ITEMS        </ul>\n      </description>\n    </release>"
else
    NEW_RELEASE="    <release version=\"$NEW_VERSION\" date=\"$TODAY\" />"
fi

sed -i "s|<releases>|<releases>\n$NEW_RELEASE|" "$METAINFO"
echo "  metainfo.xml: release $NEW_VERSION added"
echo ""

# --- Step 2: Build Flatpak ---
echo "[2/4] Building Flatpak..."
cd "$FLATPAK_DIR"
bash build-flatpak.sh
echo ""

# --- Step 3: Sign OSTree repo ---
echo "[3/4] Signing OSTree repo..."
flatpak build-update-repo \
    --gpg-sign="$GPG_KEY" \
    --generate-static-deltas \
    --default-branch=master \
    "$REPO_DIR"
echo "  Repo signed."
echo ""

# --- Step 4: Commit and push repo-flatpak ---
echo "[4/4] Publishing to GitHub Pages..."
cd "$REPO_DIR"

git add -A
if git diff --cached --quiet; then
    echo "  No changes in OSTree repo."
else
    git commit -m "release: Phantom Browser $NEW_VERSION"
    echo "  Committed."
fi

git push origin master
echo "  Pushed to origin/master."
echo ""

# --- Step 5: Tag + GitHub Release ---
echo "[5/5] Creating GitHub Release..."
cd "$SCRIPT_DIR"

# Commit and push version bump in main repo first
git add flatpak/build-flatpak.sh flatpak/io.github.anthropic.PhantomBrowser.yml \
        flatpak/io.github.anthropic.PhantomBrowser.metainfo.xml 2>/dev/null || true
if ! git diff --cached --quiet; then
    git commit -m "release: bump version to $NEW_VERSION"
fi
git push origin main

# Build release notes
RELEASE_NOTES="## Phantom Browser $NEW_VERSION"$'\n'$'\n'
if [ ${#CHANGELOG_ARGS[@]} -gt 0 ]; then
    for line in "${CHANGELOG_ARGS[@]}"; do
        RELEASE_NOTES+="- $line"$'\n'
    done
    RELEASE_NOTES+=$'\n'
fi
RELEASE_NOTES+="**Установка:**"$'\n'
RELEASE_NOTES+="\`\`\`"$'\n'
RELEASE_NOTES+="flatpak install phantom-browser.flatpakref"$'\n'
RELEASE_NOTES+="\`\`\`"$'\n'
RELEASE_NOTES+="**Обновление:**"$'\n'
RELEASE_NOTES+="\`\`\`"$'\n'
RELEASE_NOTES+="flatpak update io.github.anthropic.PhantomBrowser"$'\n'
RELEASE_NOTES+="\`\`\`"

TAG="v$NEW_VERSION"

# Delete existing tag if re-releasing same version
git tag -d "$TAG" 2>/dev/null || true
gh release delete "$TAG" --yes 2>/dev/null || true

git tag "$TAG"
git push origin "$TAG"

gh release create "$TAG" \
    --title "Phantom Browser $NEW_VERSION" \
    --notes "$RELEASE_NOTES" \
    "$SCRIPT_DIR/phantom-browser.flatpakref"

echo "  GitHub Release создан: https://github.com/SergBrowns/phantom-browser/releases/tag/$TAG"
echo ""

echo "=== Published! ==="
echo ""
echo "GitHub Release:  https://github.com/SergBrowns/phantom-browser/releases/tag/$TAG"
echo "GitHub Pages:    https://SergBrowns.github.io/phantom-browser-repo/ (через ~2 мин)"
echo ""
echo "Пользователи устанавливают:"
echo "  flatpak install phantom-browser.flatpakref"
echo ""
echo "Обновление у пользователей (или автоматически через GNOME Software):"
echo "  flatpak update io.github.anthropic.PhantomBrowser"
