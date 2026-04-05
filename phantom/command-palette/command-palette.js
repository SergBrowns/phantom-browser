/**
 * Phantom Command Palette
 * Быстрый поиск по вкладкам, истории, закладкам, действиям
 * Ctrl+K
 */

"use strict";

(function PhantomCommandPalette() {
    let paletteEl = null;
    let inputEl = null;
    let resultsEl = null;
    let isOpen = false;
    let selectedIndex = 0;
    let currentResults = [];

    // ─── Actions registry ───────────────────────────────

    const ACTIONS = [
        { type: "action", title: "New Tab", icon: "+", run: () => window.gBrowser.addTab("about:newtab", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }) },
        { type: "action", title: "New Window", icon: "W", run: () => window.open("about:blank") },
        { type: "action", title: "New Private Window", icon: "P", run: () => OpenBrowserWindow({ private: true }) },
        { type: "action", title: "Close Tab", icon: "x", run: () => window.gBrowser.removeCurrentTab() },
        { type: "action", title: "Duplicate Tab", icon: "D", run: () => window.gBrowser.duplicateTab(window.gBrowser.selectedTab) },
        { type: "action", title: "Reload Page", icon: "R", run: () => window.gBrowser.reloadTab(window.gBrowser.selectedTab) },
        { type: "action", title: "Toggle Reader Mode", icon: "R", run: () => window.PhantomReader?.toggle() },
        { type: "action", title: "Toggle Split View", icon: "S", run: () => window.PhantomSplitView?.toggle() },
        { type: "action", title: "Screenshot", icon: "S", run: () => window.PhantomQuickActions?.screenshotArea() },
        { type: "action", title: "QR Code", icon: "Q", run: () => window.PhantomQuickActions?.generateQR() },
        { type: "action", title: "Tab Timer", icon: "T", run: () => window.PhantomQuickActions?.setTabTimer() },
        { type: "action", title: "Clear Browsing Data", icon: "C", run: () => window.gBrowser.addTab("about:preferences#privacy", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }) },
        { type: "action", title: "Settings", icon: "S", run: () => window.gBrowser.addTab("about:preferences", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }) },
        { type: "action", title: "Add-ons", icon: "E", run: () => window.gBrowser.addTab("about:addons", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }) },
    ];

    // ─── UI ─────────────────────────────────────────────

    function createPalette() {
        const style = document.createElement("style");
        style.textContent = `
            #phantom-palette-overlay {
                display: none;
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(4px);
                z-index: 100000;
                justify-content: center;
                padding-top: 15vh;
            }

            #phantom-palette-overlay.open { display: flex; }

            #phantom-palette {
                width: 580px;
                max-height: 450px;
                background: #1e1e2e;
                border: 1px solid #3a3a4a;
                border-radius: 12px;
                box-shadow: 0 24px 64px rgba(0,0,0,0.6);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
            }

            #phantom-palette-input {
                width: 100%;
                padding: 14px 20px;
                background: transparent;
                border: none;
                border-bottom: 1px solid #333;
                color: #f0f0f0;
                font-size: 15px;
                outline: none;
                box-sizing: border-box;
            }

            #phantom-palette-input::placeholder { color: #666; }

            #phantom-palette-results {
                flex: 1;
                overflow-y: auto;
                padding: 6px;
            }

            .phantom-palette-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 14px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.1s;
            }

            .phantom-palette-item:hover,
            .phantom-palette-item.selected {
                background: rgba(108, 122, 224, 0.15);
            }

            .phantom-palette-item .icon {
                width: 28px;
                height: 28px;
                border-radius: 6px;
                background: rgba(255,255,255,0.06);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                color: #888;
                flex-shrink: 0;
            }

            .phantom-palette-item .info {
                flex: 1;
                overflow: hidden;
            }

            .phantom-palette-item .title {
                color: #e0e0e0;
                font-size: 13px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .phantom-palette-item .subtitle {
                color: #666;
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .phantom-palette-item .badge {
                font-size: 10px;
                color: #555;
                background: rgba(255,255,255,0.05);
                padding: 2px 6px;
                border-radius: 4px;
                flex-shrink: 0;
            }

            .phantom-palette-empty {
                padding: 24px;
                text-align: center;
                color: #555;
                font-size: 13px;
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement("div");
        overlay.id = "phantom-palette-overlay";
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closePalette();
        });

        const palette = document.createElement("div");
        palette.id = "phantom-palette";

        inputEl = document.createElement("input");
        inputEl.id = "phantom-palette-input";
        inputEl.type = "text";
        inputEl.placeholder = "Search tabs, history, bookmarks, actions...";
        inputEl.addEventListener("input", () => search(inputEl.value));
        inputEl.addEventListener("keydown", handleKeydown);

        resultsEl = document.createElement("div");
        resultsEl.id = "phantom-palette-results";

        palette.appendChild(inputEl);
        palette.appendChild(resultsEl);
        overlay.appendChild(palette);
        document.documentElement.appendChild(overlay);
        paletteEl = overlay;
    }

    // ─── Search ─────────────────────────────────────────

    async function search(query) {
        const q = query.trim().toLowerCase();

        if (!q) {
            // Показать открытые вкладки + действия
            currentResults = [
                ...getOpenTabs(""),
                ...ACTIONS.slice(0, 5),
            ];
            renderResults();
            return;
        }

        // Параллельный поиск
        const [tabs, history, bookmarks, actions] = await Promise.all([
            Promise.resolve(getOpenTabs(q)),
            searchHistory(q),
            searchBookmarks(q),
            Promise.resolve(searchActions(q)),
        ]);

        currentResults = [];

        // Приоритет: вкладки → действия → закладки → история
        currentResults.push(...tabs.slice(0, 5));
        currentResults.push(...actions.slice(0, 5));
        currentResults.push(...bookmarks.slice(0, 5));
        currentResults.push(...history.slice(0, 10));

        selectedIndex = 0;
        renderResults();
    }

    function getOpenTabs(query) {
        const tabs = [];
        for (const tab of window.gBrowser.tabs) {
            if (tab.hidden) continue;
            const title = tab.label || "";
            const url = tab.linkedBrowser?.currentURI?.spec || "";

            if (!query || title.toLowerCase().includes(query) || url.toLowerCase().includes(query)) {
                tabs.push({
                    type: "tab",
                    title,
                    subtitle: url,
                    icon: "T",
                    run: () => window.gBrowser.selectedTab = tab,
                });
            }
        }
        return tabs;
    }

    async function searchHistory(query) {
        try {
            const results = [];
            const historyQuery = PlacesUtils.history.executeQuery(
                PlacesUtils.history.getNewQuery(),
                PlacesUtils.history.getNewQueryOptions()
            );
            // Use Places API for async search
            const matches = await PlacesUtils.history.executeQuery({
                searchString: query,
                limit: 10,
            });

            for (const match of matches) {
                results.push({
                    type: "history",
                    title: match.title || match.url,
                    subtitle: match.url,
                    icon: "H",
                    run: () => window.gBrowser.addTab(match.url, {
                        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                    }),
                });
            }
            return results;
        } catch {
            return [];
        }
    }

    async function searchBookmarks(query) {
        try {
            const results = [];
            const bookmarks = await PlacesUtils.bookmarks.search({ query, limit: 5 });

            for (const bm of bookmarks) {
                if (!bm.url) continue;
                results.push({
                    type: "bookmark",
                    title: bm.title || bm.url.href,
                    subtitle: bm.url.href,
                    icon: "B",
                    run: () => window.gBrowser.addTab(bm.url.href, {
                        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                    }),
                });
            }
            return results;
        } catch {
            return [];
        }
    }

    function searchActions(query) {
        return ACTIONS.filter(a =>
            a.title.toLowerCase().includes(query)
        );
    }

    // ─── Render ─────────────────────────────────────────

    function renderResults() {
        resultsEl.innerHTML = "";

        if (currentResults.length === 0) {
            resultsEl.innerHTML = '<div class="phantom-palette-empty">No results</div>';
            return;
        }

        currentResults.forEach((result, index) => {
            const item = document.createElement("div");
            item.className = `phantom-palette-item${index === selectedIndex ? " selected" : ""}`;

            item.innerHTML = `
                <div class="icon">${result.icon || "?"}</div>
                <div class="info">
                    <div class="title">${escapeHtml(result.title)}</div>
                    ${result.subtitle ? `<div class="subtitle">${escapeHtml(result.subtitle)}</div>` : ""}
                </div>
                <div class="badge">${result.type}</div>
            `;

            item.addEventListener("click", () => executeResult(result));
            item.addEventListener("mouseenter", () => {
                selectedIndex = index;
                updateSelection();
            });

            resultsEl.appendChild(item);
        });
    }

    function updateSelection() {
        const items = resultsEl.querySelectorAll(".phantom-palette-item");
        items.forEach((el, i) => {
            el.classList.toggle("selected", i === selectedIndex);
        });

        // Scroll into view
        items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }

    function executeResult(result) {
        closePalette();
        if (result.run) result.run();
    }

    // ─── Keyboard ───────────────────────────────────────

    function handleKeydown(e) {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
                updateSelection();
                break;

            case "ArrowUp":
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                updateSelection();
                break;

            case "Enter":
                e.preventDefault();
                if (currentResults[selectedIndex]) {
                    executeResult(currentResults[selectedIndex]);
                }
                break;

            case "Escape":
                e.preventDefault();
                closePalette();
                break;
        }
    }

    // ─── Open / Close ───────────────────────────────────

    function openPalette() {
        if (!paletteEl) createPalette();
        isOpen = true;
        paletteEl.classList.add("open");
        inputEl.value = "";
        selectedIndex = 0;
        search("");
        inputEl.focus();
    }

    function closePalette() {
        isOpen = false;
        if (paletteEl) paletteEl.classList.remove("open");
    }

    function togglePalette() {
        if (isOpen) closePalette();
        else openPalette();
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Shortcut Ctrl+K ────────────────────────────────

    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            e.stopPropagation();
            togglePalette();
        }
    }, true);

    function registerAction(action) {
        if (!ACTIONS.find(a => a.title === action.title)) {
            ACTIONS.push(action);
        }
    }

    window.PhantomCommandPalette = { open: openPalette, close: closePalette, toggle: togglePalette, registerAction };
})();
