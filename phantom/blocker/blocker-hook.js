/**
 * Phantom Ad Blocker — Hook
 * Подключается к сетевому стеку Firefox для блокировки запросов
 */

"use strict";

(function PhantomBlockerHook() {
    const { phantomBlocker } = ChromeUtils.importESModule(
        "resource://phantom/blocker/blocker-engine.sys.mjs"
    );

    const BLOCKED_TYPES = new Set([
        "script",
        "image",
        "stylesheet",
        "xmlhttprequest",
        "sub_frame",
        "object",
        "media",
        "font",
        "websocket",
        "ping",    // <a ping="...">
        "beacon",  // navigator.sendBeacon() — частый вектор трекинга при закрытии вкладки
        "other",
    ]);

    // ─── Network observer ───────────────────────────────

    const httpObserver = {
        observe(subject, topic) {
            if (topic !== "http-on-modify-request") return;

            const channel = subject.QueryInterface(Ci.nsIHttpChannel);
            const url = channel.URI.spec;

            // Не блокируем системные запросы
            if (url.startsWith("about:") || url.startsWith("chrome:") ||
                url.startsWith("resource:") || url.startsWith("moz-extension:")) {
                return;
            }

            // Определяем тип ресурса
            let type = "other";
            try {
                const loadInfo = channel.loadInfo;
                if (loadInfo) {
                    const contentType = loadInfo.externalContentPolicyType || loadInfo.contentPolicyType;
                    type = contentPolicyTypeToString(contentType);
                }
            } catch {}

            if (!BLOCKED_TYPES.has(type)) return;

            // Определяем source URL
            let sourceUrl = "";
            try {
                const loadInfo = channel.loadInfo;
                if (loadInfo && loadInfo.loadingPrincipal) {
                    sourceUrl = loadInfo.loadingPrincipal.URI?.spec || "";
                }
            } catch {}

            // Проверяем, нужно ли блокировать
            if (phantomBlocker.shouldBlock(url, sourceUrl, type)) {
                channel.cancel(Cr.NS_ERROR_ABORT);
            }
        }
    };

    function contentPolicyTypeToString(type) {
        switch (type) {
            case Ci.nsIContentPolicy.TYPE_DOCUMENT: return "document";
            case Ci.nsIContentPolicy.TYPE_SCRIPT: return "script";
            case Ci.nsIContentPolicy.TYPE_IMAGE: return "image";
            case Ci.nsIContentPolicy.TYPE_STYLESHEET: return "stylesheet";
            case Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST: return "xmlhttprequest";
            case Ci.nsIContentPolicy.TYPE_SUBDOCUMENT: return "sub_frame";
            case Ci.nsIContentPolicy.TYPE_OBJECT: return "object";
            case Ci.nsIContentPolicy.TYPE_MEDIA: return "media";
            case Ci.nsIContentPolicy.TYPE_FONT: return "font";
            case Ci.nsIContentPolicy.TYPE_WEBSOCKET: return "websocket";
            case Ci.nsIContentPolicy.TYPE_PING: return "ping";
            case Ci.nsIContentPolicy.TYPE_BEACON: return "beacon";
            default: return "other";
        }
    }

    // ─── Cosmetic filtering ─────────────────────────────

    function applyCosmeticFilters(browser) {
        try {
            const doc = browser.contentDocument;
            if (!doc || !doc.body) return;

            const uri = browser.currentURI;
            if (!uri || uri.scheme === "about" || uri.scheme === "chrome" || uri.scheme === "resource") return;

            let hostname;
            try { hostname = uri.host; } catch { return; }
            const selectors = phantomBlocker.getCosmeticFilters(hostname);

            if (selectors.length === 0) return;

            // Инжектим CSS для скрытия элементов
            let styleEl = doc.getElementById("phantom-cosmetic-filters");
            if (!styleEl) {
                styleEl = doc.createElement("style");
                styleEl.id = "phantom-cosmetic-filters";
                doc.head.appendChild(styleEl);
            }

            // Разбиваем на чанки по 100 селекторов для надёжности
            const chunks = [];
            for (let i = 0; i < selectors.length; i += 100) {
                const chunk = selectors.slice(i, i + 100);
                chunks.push(chunk.join(", ") + " { display: none !important; }");
            }

            styleEl.textContent = chunks.join("\n");
        } catch (e) {
            console.debug("[Blocker] Cosmetic filter error:", e.message);
        }
    }

    // ─── Stats badge ────────────────────────────────────

    function updateStatsBadge() {
        const stats = phantomBlocker.stats;
        // Можно обновить UI элемент, показывающий количество заблокированных
        // Это опционально — данные доступны через phantomBlocker.stats
    }

    // ─── Init ───────────────────────────────────────────

    async function init() {
        const enabled = Services.prefs.getBoolPref("phantom.blocker.enabled", true);
        if (!enabled) return;

        await phantomBlocker.init();

        // Регистрируем network observer
        Services.obs.addObserver(httpObserver, "http-on-modify-request");

        // Cosmetic filters при загрузке страниц
        window.gBrowser.addTabsProgressListener({
            onStateChange(browser, webProgress, request, stateFlags) {
                if (!webProgress.isTopLevel) return;

                const STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP;
                const STATE_IS_NETWORK = Ci.nsIWebProgressListener.STATE_IS_NETWORK;

                if (!(stateFlags & STATE_STOP) || !(stateFlags & STATE_IS_NETWORK)) return;

                setTimeout(() => applyCosmeticFilters(browser), 500);
            }
        });

        // Stats updated on-demand via phantomBlocker.stats

        console.log(`[Blocker] Active with ${phantomBlocker.ruleCount} rules`);
    }

    // Cleanup при закрытии окна
    window.addEventListener("unload", () => {
        try {
            Services.obs.removeObserver(httpObserver, "http-on-modify-request");
        } catch {}
    });

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });
})();
