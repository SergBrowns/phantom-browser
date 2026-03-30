/**
 * Phantom Smart History — hook
 * Listens for navigation, extracts page text and indexes it
 * Uses requestIdleCallback to avoid blocking the UI thread
 */

"use strict";

(function PhantomSmartHistory() {
    const { phantomHistory } = ChromeUtils.importESModule(
        "resource://phantom/smart-history/history-indexer.sys.mjs"
    );

    const indexQueue = [];
    let idleScheduled = false;

    async function init() {
        const enabled = Services.prefs.getBoolPref("phantom.smarthistory.enabled", true);
        if (!enabled) return;

        await phantomHistory.init();

        window.gBrowser.addTabsProgressListener({
            onStateChange(browser, webProgress, request, stateFlags) {
                if (!webProgress.isTopLevel) return;
                const STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP;
                const STATE_IS_NETWORK = Ci.nsIWebProgressListener.STATE_IS_NETWORK;
                if (!(stateFlags & STATE_STOP) || !(stateFlags & STATE_IS_NETWORK)) return;

                // Queue for idle indexing instead of blocking UI thread
                indexQueue.push(browser);
                scheduleIdle();
            }
        });

        // Cleanup daily
        const maxAge = Services.prefs.getIntPref("phantom.smarthistory.maxAgeDays", 90);
        const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timer.initWithCallback(() => phantomHistory.cleanup(maxAge).catch(() => {}),
            24 * 60 * 60 * 1000, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }

    function scheduleIdle() {
        if (idleScheduled) return;
        idleScheduled = true;

        // Wait 2s for page to render, then use idle callback
        setTimeout(() => {
            if (typeof requestIdleCallback === "function") {
                requestIdleCallback(() => processQueue(), { timeout: 10000 });
            } else {
                // Fallback
                setTimeout(() => processQueue(), 1000);
            }
        }, 2000);
    }

    async function processQueue() {
        idleScheduled = false;
        while (indexQueue.length > 0) {
            const browser = indexQueue.shift();
            await indexTab(browser);
        }
    }

    async function indexTab(browser) {
        try {
            const doc = browser.contentDocument;
            if (!doc || !doc.body) return;

            const url = browser.currentURI.spec;
            const title = doc.title || "";
            const content = doc.body.innerText || "";
            const domain = browser.currentURI.host || "";

            await phantomHistory.indexPage({ url, title, content, domain });
        } catch (e) {
            console.debug("[SmartHistory] Index error:", e.message);
        }
    }

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });
})();
