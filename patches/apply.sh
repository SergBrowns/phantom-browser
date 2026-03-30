#!/bin/bash
# Apply Phantom patches to Firefox source tree
set -euo pipefail

FIREFOX_SRC="${1:?Usage: apply.sh <firefox-source-dir>}"
FIREFOX_SRC="${FIREFOX_SRC/#\~/$HOME}"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Applying patches from $PATCH_DIR to $FIREFOX_SRC"

# Patch browser.xhtml to load Phantom modules
cat > "$PATCH_DIR/001-phantom-loader.patch" << 'PATCH'
--- a/browser/base/content/browser.xhtml
+++ b/browser/base/content/browser.xhtml
@@ -58,6 +58,9 @@
   <script type="text/javascript">
     Services.scriptloader.loadSubScript("chrome://browser/content/browser-init.js", this);
   </script>
+
+  <!-- Phantom Browser modules -->
+  <script type="text/javascript" src="chrome://phantom/content/phantom-loader.js"/>
 </head>
PATCH

# Patch chrome.manifest to register Phantom content
cat > "$PATCH_DIR/002-phantom-manifest.patch" << 'PATCH'
--- a/browser/base/jar.mn
+++ b/browser/base/jar.mn
@@ -1,3 +1,6 @@
+# Phantom Browser
+% content phantom %phantom/ contentaccessible=yes
+% resource phantom %phantom/
 browser.jar:
PATCH

for patch in "$PATCH_DIR"/*.patch; do
    [ -f "$patch" ] || continue
    echo "  Applying: $(basename "$patch")"
    cd "$FIREFOX_SRC"
    git apply --check "$patch" 2>/dev/null && git apply "$patch" || {
        echo "  Warning: $(basename "$patch") may already be applied, skipping"
    }
done

echo "Patches applied."
