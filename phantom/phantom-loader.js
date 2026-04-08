/**
 * Phantom Browser — Module Loader (v2 — parallel loading)
 * Loads all Phantom modules into browser chrome
 */

"use strict";

(function PhantomLoader() {
    // Modules grouped by dependency:
    // Group 1: UI — independent, load in parallel
    // Group 2: Network — proxy→dpi→vpn (ordered)
    // Group 3: Extras — independent, load in parallel

    const uiModules = [
        "chrome://phantom/content/spaces/spaces-bar.js",
        "chrome://phantom/content/vertical-tabs/vertical-tabs.js",
        "chrome://phantom/content/focus-mode/focus-mode.js",
        "chrome://phantom/content/command-palette/command-palette.js",
        "chrome://phantom/content/split-view/split-view.js",
        "chrome://phantom/content/reader/reader-view.js",
        "chrome://phantom/content/reader/cookie-killer.js",
    ];

    const networkModules = [
        "chrome://phantom/content/blocker/blocker-hook.js",
        "chrome://phantom/content/proxy/proxy-hook.js",
        "chrome://phantom/content/dpi/dpi-hook.js",
        "chrome://phantom/content/vpn/vpn-hook.js",
    ];

    const extraModules = [
        "chrome://phantom/content/smart-history/history-hook.js",
        "chrome://phantom/content/quick-actions/quick-actions.js",
        "chrome://phantom/content/profile-importer/profile-importer-hook.js",
    ];

    // Диагностика доступна глобально: window.PhantomDiagnostics.save()
    const diagModule = ChromeUtils.importESModule(
        "resource://phantom/diagnostics/diagnostics.sys.mjs"
    );
    window.PhantomDiagnostics = {
        export: diagModule.exportDiagnostics,
        save:   diagModule.saveDiagnosticsToFile,
    };

    function loadModule(src) {
        return new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            script.onerror = () => {
                console.warn(`[Phantom] Failed to load: ${src}`);
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    // Set new tab URL after chrome package is registered
    function setNewTabUrl() {
        const url = "chrome://phantom/content/new-tab/new-tab.html";
        try {
            // Firefox 127+ module-based API
            const { AboutNewTab } = ChromeUtils.importESModule(
                "resource:///modules/AboutNewTab.sys.mjs"
            );
            if (AboutNewTab.newTabURL !== url) AboutNewTab.newTabURL = url;
            return;
        } catch {}
        try {
            // Fallback: XPCOM service
            const svc = Cc["@mozilla.org/browser/aboutnewtab-service;1"]
                .getService(Ci.nsIAboutNewTabService);
            if (svc.newTabURL !== url) svc.newTabURL = url;
        } catch {}
    }

    async function init() {
        console.log("[Phantom] Loading modules...");
        const start = performance.now();

        setNewTabUrl();

        window._phantomLoading = true;

        // Phase 1: UI modules — all in parallel (no dependencies)
        await Promise.all(uiModules.map(loadModule));

        // Phase 2: Network modules — sequential (proxy→dpi→vpn dependency)
        for (const mod of networkModules) {
            await loadModule(mod);
        }

        // Phase 3: Extras — all in parallel
        await Promise.all(extraModules.map(loadModule));

        window._phantomLoading = false;
        window.dispatchEvent(new CustomEvent("phantom-ready"));

        const elapsed = (performance.now() - start).toFixed(0);
        console.log(`[Phantom] All modules loaded in ${elapsed}ms`);
    }

    if (document.readyState === "complete") {
        init();
    } else {
        window.addEventListener("load", init, { once: true });
    }
})();
