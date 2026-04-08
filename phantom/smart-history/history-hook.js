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

        // Close DB on shutdown — prevents AsyncShutdown crash
        Services.obs.addObserver(() => {
            phantomHistory.close().catch(() => {});
        }, "profile-before-change");

        initSearchUI();
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

    // ── Search UI ───────────────────────────────────────────────────────────

    const SEARCH_STYLES = `
        #ph-history-panel {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -56%);
            width: 600px; max-height: 520px; display: flex; flex-direction: column;
            background: #111827; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,0.7);
            z-index: 99999; font-family: -apple-system, "Segoe UI", sans-serif;
            color: #e2e8f0; font-size: 13px; opacity: 0;
            transition: opacity 0.14s, transform 0.14s;
            pointer-events: none;
        }
        #ph-history-panel.open {
            opacity: 1; transform: translate(-50%, -50%); pointer-events: auto;
        }
        #ph-history-backdrop {
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            backdrop-filter: blur(4px); z-index: 99998;
            display: none;
        }
        #ph-history-backdrop.open { display: block; }

        #ph-history-search-wrap {
            display: flex; align-items: center; gap: 10px;
            padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        #ph-history-search-wrap svg { flex-shrink: 0; color: #6b7280; }
        #ph-history-input {
            flex: 1; background: none; border: none; outline: none;
            color: #f1f5f9; font-size: 15px; font-family: inherit;
        }
        #ph-history-input::placeholder { color: #4b5563; }
        #ph-history-count { font-size: 11px; color: #4b5563; white-space: nowrap; }

        #ph-history-results { overflow-y: auto; flex: 1; padding: 6px 8px; }

        .ph-hr {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 9px 10px; border-radius: 9px; cursor: pointer;
            transition: background 0.12s; text-decoration: none;
        }
        .ph-hr:hover { background: rgba(255,255,255,0.05); }
        .ph-hr.selected { background: rgba(99,102,241,0.15); }

        .ph-hr-favicon {
            width: 20px; height: 20px; border-radius: 5px; flex-shrink: 0;
            background: rgba(255,255,255,0.06); display: flex; align-items: center;
            justify-content: center; font-size: 10px; color: #6b7280;
            border: 1px solid rgba(255,255,255,0.06); margin-top: 1px;
            overflow: hidden;
        }
        .ph-hr-favicon img { width: 14px; height: 14px; object-fit: contain; }

        .ph-hr-body { flex: 1; min-width: 0; }
        .ph-hr-title {
            color: #e2e8f0; font-size: 13px; font-weight: 500;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ph-hr-title b { color: #818cf8; font-weight: 600; }
        .ph-hr-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
        .ph-hr-domain { font-size: 11px; color: #6366f1; }
        .ph-hr-time { font-size: 11px; color: #4b5563; }
        .ph-hr-cat {
            font-size: 10px; color: #374151; background: rgba(255,255,255,0.06);
            border-radius: 4px; padding: 1px 5px; text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .ph-hr-snippet {
            font-size: 11px; color: #6b7280; margin-top: 3px;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .ph-hr-snippet b { color: #9ca3af; font-weight: 600; }

        #ph-history-empty {
            text-align: center; color: #4b5563; padding: 40px 0; font-size: 13px;
        }
        #ph-history-footer {
            padding: 9px 16px; border-top: 1px solid rgba(255,255,255,0.06);
            font-size: 11px; color: #374151; display: flex; gap: 16px;
        }
        #ph-history-footer kbd {
            background: rgba(255,255,255,0.06); border-radius: 4px;
            padding: 1px 5px; font-family: inherit; font-size: 10px; color: #6b7280;
        }
    `;

    let historyPanelOpen = false;
    let selectedIdx = -1;
    let currentResults = [];
    let debounceTimer = null;

    function initSearchUI() {
        const style = document.createElement("style");
        style.textContent = SEARCH_STYLES;
        document.head.appendChild(style);

        // Backdrop
        const backdrop = document.createElement("div");
        backdrop.id = "ph-history-backdrop";
        backdrop.addEventListener("click", closeHistoryPanel);
        document.documentElement.appendChild(backdrop);

        // Panel
        const panel = document.createElement("div");
        panel.id = "ph-history-panel";
        panel.innerHTML = `
            <div id="ph-history-search-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
                </svg>
                <input id="ph-history-input" type="text" placeholder="Поиск по истории..." autocomplete="off" spellcheck="false" />
                <span id="ph-history-count"></span>
            </div>
            <div id="ph-history-results"></div>
            <div id="ph-history-footer">
                <span><kbd>↑↓</kbd> навигация</span>
                <span><kbd>Enter</kbd> открыть</span>
                <span><kbd>Esc</kbd> закрыть</span>
            </div>
        `;
        document.documentElement.appendChild(panel);

        panel.querySelector("#ph-history-input").addEventListener("input", (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => runSearch(e.target.value.trim()), 280);
        });

        panel.querySelector("#ph-history-input").addEventListener("keydown", handleSearchKeydown);

        // Keyboard shortcut: Ctrl+Shift+H
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyH") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                historyPanelOpen ? closeHistoryPanel() : openHistoryPanel();
            }
            if (e.key === "Escape" && historyPanelOpen) closeHistoryPanel();
        }, true);
    }

    function openHistoryPanel() {
        historyPanelOpen = true;
        selectedIdx = -1;
        currentResults = [];
        document.getElementById("ph-history-backdrop")?.classList.add("open");
        const panel = document.getElementById("ph-history-panel");
        panel?.classList.add("open");
        const input = panel?.querySelector("#ph-history-input");
        if (input) { input.value = ""; input.focus(); }
        renderResults([]);
    }

    function closeHistoryPanel() {
        historyPanelOpen = false;
        document.getElementById("ph-history-backdrop")?.classList.remove("open");
        document.getElementById("ph-history-panel")?.classList.remove("open");
        clearTimeout(debounceTimer);
    }

    async function runSearch(query) {
        if (!query) { renderResults([]); return; }
        try {
            const results = await phantomHistory.search(query, 25);
            currentResults = results;
            selectedIdx = results.length > 0 ? 0 : -1;
            renderResults(results);
        } catch (e) {
            console.debug("[SmartHistory] Search error:", e.message);
        }
    }

    function renderResults(results) {
        const container = document.getElementById("ph-history-results");
        if (!container) return;

        document.getElementById("ph-history-count").textContent =
            results.length > 0 ? `${results.length} результатов` : "";

        if (results.length === 0) {
            const q = document.getElementById("ph-history-input")?.value?.trim();
            container.innerHTML = `<div id="ph-history-empty">${q ? "Ничего не найдено" : "Начните вводить запрос"}</div>`;
            return;
        }

        container.innerHTML = "";
        results.forEach((r, i) => {
            const el = document.createElement("a");
            el.className = "ph-hr" + (i === selectedIdx ? " selected" : "");
            el.href = r.url;

            const timeStr = formatRelTime(r.visitTime);
            const favEl = `<div class="ph-hr-favicon"><img src="https://${r.domain}/favicon.ico" onerror="this.remove();this.parentNode.textContent='${(r.domain[0]||'?').toUpperCase()}'" /></div>`;

            el.innerHTML = `
                ${favEl}
                <div class="ph-hr-body">
                    <div class="ph-hr-title">${esc(r.title || r.url)}</div>
                    <div class="ph-hr-meta">
                        <span class="ph-hr-domain">${esc(r.domain)}</span>
                        <span class="ph-hr-time">${timeStr}</span>
                        ${r.category !== "other" ? `<span class="ph-hr-cat">${esc(r.category)}</span>` : ""}
                    </div>
                    ${r.snippet ? `<div class="ph-hr-snippet">${r.snippet}</div>` : ""}
                </div>
            `;

            el.addEventListener("click", (e) => {
                e.preventDefault();
                closeHistoryPanel();
                gBrowser.loadURI(Services.io.newURI(r.url), {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                });
            });

            container.appendChild(el);
        });
    }

    function handleSearchKeydown(e) {
        if (currentResults.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedIdx = Math.min(selectedIdx + 1, currentResults.length - 1);
            updateSelection();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedIdx = Math.max(selectedIdx - 1, 0);
            updateSelection();
        } else if (e.key === "Enter" && selectedIdx >= 0) {
            e.preventDefault();
            const r = currentResults[selectedIdx];
            if (r) {
                closeHistoryPanel();
                gBrowser.loadURI(Services.io.newURI(r.url), {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                });
            }
        }
    }

    function updateSelection() {
        const items = document.querySelectorAll(".ph-hr");
        items.forEach((el, i) => el.classList.toggle("selected", i === selectedIdx));
        items[selectedIdx]?.scrollIntoView({ block: "nearest" });
    }

    function formatRelTime(ts) {
        const diff = Date.now() - ts;
        const m = Math.floor(diff / 60000);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (d > 0) return `${d}д назад`;
        if (h > 0) return `${h}ч назад`;
        if (m > 0) return `${m}м назад`;
        return "только что";
    }

    function esc(s) {
        return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });
})();
