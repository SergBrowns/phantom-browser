/**
 * Phantom Sidebar — вертикальные вкладки + пространства
 * Встраивается в #tabbrowser-tabbox (рядом с контентом, под URL-баром)
 *
 * Ctrl+B   — свернуть / развернуть
 * Alt+1..9 — переключить пространство
 */

"use strict";

(function PhantomSidebar() {
    const { phantomSpaces } = ChromeUtils.importESModule(
        "resource://phantom/spaces/spaces-manager.sys.mjs"
    );

    let sidebar       = null;
    let tabsContainer = null;
    let spacesContainer = null;
    let isCollapsed   = false;

    // ─── Styles ──────────────────────────────────────────

    function injectStyles() {
        const style = document.createElement("style");
        style.id = "phantom-sidebar-styles";
        style.textContent = `
            /* ── Скрываем tab bar целиком (кнопки окна переносим через JS) ── */
            #TabsToolbar { display: none !important; }

            /* Стили для нативных кнопок окна после переноса в sidebar */
            #phantom-win-controls {
                display: flex;
                align-items: center;
                justify-content: flex-start;
                padding: 10px 12px 2px;
                flex-shrink: 0;
                -moz-window-dragging: drag;
                min-height: 32px;
            }

            #phantom-win-controls .titlebar-buttonbox-container {
                -moz-window-dragging: no-drag;
            }

            /* Кастомные кнопки (если нативных нет — Wayland/Hyprland) */
            #phantom-win-controls.custom-controls {
                gap: 7px;
            }

            .phantom-wc {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                border: none;
                cursor: pointer;
                flex-shrink: 0;
                -moz-window-dragging: no-drag;
                transition: filter 0.1s, transform 0.1s;
                padding: 0;
            }

            .phantom-wc:hover  { filter: brightness(1.25); transform: scale(1.1); }
            .phantom-wc:active { transform: scale(0.9); }

            #phantom-wc-close { background: #ff5f57; }
            #phantom-wc-min   { background: #febc2e; }
            #phantom-wc-max   { background: #28c840; }

            .collapsed #phantom-win-controls { padding: 10px 0 2px; justify-content: center; }

            /* Скрываем нативный Firefox sidebar/splitter */
            #sidebar-box      { display: none !important; }
            #sidebar-splitter { display: none !important; }

            /* ── Контейнер вкладок — flex-row ───────────────── */
            /* Firefox уже делает его flex, но на всякий случай: */
            #tabbrowser-tabbox {
                display: flex !important;
                flex-direction: row !important;
                flex: 1 1 0% !important;
                min-height: 0 !important;
                overflow: hidden !important;
            }

            /* Контент-панель занимает остаток */
            #appcontent {
                flex: 1 1 0% !important;
                min-width: 0 !important;
                overflow: hidden !important;
            }

            /* ── Sidebar ────────────────────────────────────── */
            #phantom-sidebar {
                display: flex;
                flex-direction: column;
                width: 240px;
                min-width: 240px;
                height: 100%;
                background: #13131f;
                border-right: 1px solid rgba(255,255,255,0.1);
                flex-shrink: 0;
                overflow: hidden;
                transition: width 0.22s cubic-bezier(0.4,0,0.2,1),
                            min-width 0.22s cubic-bezier(0.4,0,0.2,1);
                position: relative;
                z-index: 10;
                user-select: none;
                -moz-window-dragging: drag;
            }

            #phantom-sidebar.collapsed {
                width: 54px;
                min-width: 54px;
            }

            body.phantom-focus #phantom-sidebar { display: none !important; }

            /* ── Header ─────────────────────────────────────── */
            #phantom-sidebar-header {
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 8px 0 12px;
                flex-shrink: 0;
                -moz-window-dragging: drag;
            }

            #phantom-brand {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                overflow: hidden;
                -moz-window-dragging: no-drag;
            }

            #phantom-brand-mark {
                width: 22px;
                height: 22px;
                border-radius: 7px;
                background: linear-gradient(135deg, #818cf8, #6366f1);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 700;
                color: #fff;
                flex-shrink: 0;
                letter-spacing: -0.03em;
                box-shadow: 0 2px 8px rgba(99,102,241,0.4);
            }

            #phantom-brand-name {
                font-size: 13px;
                font-weight: 700;
                color: rgba(255,255,255,0.85);
                white-space: nowrap;
                overflow: hidden;
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                letter-spacing: -0.02em;
                transition: opacity 0.18s;
            }

            #phantom-collapse-btn {
                width: 26px;
                height: 26px;
                border: none;
                background: rgba(255,255,255,0.06);
                color: rgba(255,255,255,0.55);
                border-radius: 7px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                -moz-window-dragging: no-drag;
                transition: background 0.12s, color 0.12s, transform 0.22s;
                padding: 0;
                font-size: 16px;
                line-height: 1;
            }

            #phantom-collapse-btn:hover {
                background: rgba(255,255,255,0.12);
                color: rgba(255,255,255,0.9);
            }

            .collapsed #phantom-brand-name { opacity: 0; width: 0; }
            .collapsed #phantom-sidebar-header { justify-content: center; padding: 0 6px; }
            .collapsed #phantom-brand { flex: 0; justify-content: center; }
            .collapsed #phantom-collapse-btn {
                transform: rotate(180deg);
                opacity: 0;
                pointer-events: none;
            }
            .collapsed #phantom-sidebar-header:hover #phantom-collapse-btn {
                opacity: 1;
                pointer-events: auto;
            }

            /* ── Spaces ─────────────────────────────────────── */
            #phantom-spaces-section {
                padding: 0 8px 6px;
                flex-shrink: 0;
            }

            #phantom-spaces-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 2px 2px 5px 6px;
            }

            #phantom-spaces-label {
                font-size: 10px;
                font-weight: 700;
                color: rgba(255,255,255,0.35);
                text-transform: uppercase;
                letter-spacing: 0.1em;
                white-space: nowrap;
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                transition: opacity 0.15s;
            }

            .collapsed #phantom-spaces-label { opacity: 0; }

            /* Кнопка "+" добавить space */
            #phantom-add-space-btn {
                width: 22px;
                height: 22px;
                border: none;
                border-radius: 6px;
                background: rgba(255,255,255,0.07);
                color: rgba(255,255,255,0.55);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                line-height: 1;
                padding: 0;
                flex-shrink: 0;
                -moz-window-dragging: no-drag;
                transition: background 0.12s, color 0.12s;
            }

            #phantom-add-space-btn:hover {
                background: rgba(129,140,248,0.25);
                color: #a5b4fc;
            }

            .collapsed #phantom-spaces-header { justify-content: center; padding: 2px 0 5px; }
            .collapsed #phantom-spaces-label  { display: none; }
            .collapsed #phantom-add-space-btn { display: none; }

            /* форма создания space — используется нативный prompt */

            #phantom-spaces-list {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .phantom-space-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0 8px;
                height: 36px;
                border-radius: 9px;
                cursor: pointer;
                transition: background 0.12s;
                -moz-window-dragging: no-drag;
                overflow: hidden;
            }

            .phantom-space-item:hover  { background: rgba(255,255,255,0.07); }
            .phantom-space-item.active { background: rgba(129,140,248,0.18); }

            .phantom-space-dot {
                width: 26px;
                height: 26px;
                border-radius: 8px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 700;
                transition: transform 0.15s;
            }

            .phantom-space-item:hover  .phantom-space-dot { transform: scale(1.08); }
            .phantom-space-item.active .phantom-space-dot {
                box-shadow: 0 0 0 2px rgba(255,255,255,0.2);
            }

            .phantom-space-name {
                font-size: 13px;
                font-weight: 500;
                color: rgba(255,255,255,0.7);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                transition: color 0.12s;
                flex: 1;
            }

            .phantom-space-item:hover  .phantom-space-name { color: rgba(255,255,255,0.95); }
            .phantom-space-item.active .phantom-space-name {
                color: #fff;
                font-weight: 600;
            }

            .phantom-space-count {
                font-size: 11px;
                font-weight: 600;
                color: rgba(255,255,255,0.35);
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                flex-shrink: 0;
                background: rgba(255,255,255,0.08);
                border-radius: 5px;
                padding: 1px 5px;
                min-width: 18px;
                text-align: center;
            }

            .phantom-space-item.active .phantom-space-count {
                background: rgba(129,140,248,0.25);
                color: rgba(200,205,255,0.9);
            }

            .collapsed .phantom-space-name,
            .collapsed .phantom-space-count { display: none; }
            .collapsed .phantom-space-item { justify-content: center; padding: 0 5px; }

            /* ── Divider ────────────────────────────────────── */
            .phantom-divider {
                height: 1px;
                background: rgba(255,255,255,0.08);
                margin: 6px 10px;
                flex-shrink: 0;
            }

            /* ── Tabs section ───────────────────────────────── */
            #phantom-tabs-section {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-height: 0;
            }

            #phantom-tabs-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 2px 8px 5px 14px;
                flex-shrink: 0;
            }

            #phantom-tabs-label {
                font-size: 10px;
                font-weight: 700;
                color: rgba(255,255,255,0.35);
                text-transform: uppercase;
                letter-spacing: 0.1em;
                white-space: nowrap;
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                transition: opacity 0.15s;
            }

            .collapsed #phantom-tabs-label { opacity: 0; }

            #phantom-new-tab-btn {
                width: 24px;
                height: 24px;
                border: none;
                border-radius: 7px;
                background: rgba(255,255,255,0.07);
                color: rgba(255,255,255,0.6);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                line-height: 1;
                padding: 0;
                flex-shrink: 0;
                -moz-window-dragging: no-drag;
                transition: background 0.12s, color 0.12s;
            }

            #phantom-new-tab-btn:hover {
                background: rgba(129,140,248,0.25);
                color: #a5b4fc;
            }

            .collapsed #phantom-tabs-header { justify-content: center; padding: 2px 5px 5px; }
            .collapsed #phantom-tabs-label  { display: none; }

            #phantom-tabs-list {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.12) transparent;
                padding: 0 6px;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            /* ── Tab item ───────────────────────────────────── */
            .phantom-tab {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 0 8px 0 10px;
                height: 38px;
                border-radius: 9px;
                cursor: pointer;
                position: relative;
                flex-shrink: 0;
                transition: background 0.1s;
                -moz-window-dragging: no-drag;
                overflow: hidden;
            }

            .phantom-tab::before {
                content: '';
                position: absolute;
                left: 0;
                top: 20%;
                bottom: 20%;
                width: 3px;
                background: #818cf8;
                border-radius: 0 3px 3px 0;
                opacity: 0;
                transition: opacity 0.15s, transform 0.15s;
                transform: scaleY(0.4);
            }

            .phantom-tab:hover            { background: rgba(255,255,255,0.07); }
            .phantom-tab.selected         { background: rgba(129,140,248,0.18); }
            .phantom-tab.selected::before { opacity: 1; transform: scaleY(1); }

            .phantom-tab-favicon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
                object-fit: contain;
                border-radius: 3px;
            }

            .phantom-tab-favicon-default {
                width: 16px;
                height: 16px;
                border-radius: 3px;
                background: rgba(255,255,255,0.12);
                flex-shrink: 0;
            }

            .phantom-tab-title {
                flex: 1;
                font-size: 13px;
                font-weight: 400;
                color: rgba(255,255,255,0.65);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: -apple-system, "Inter", system-ui, sans-serif;
                letter-spacing: -0.01em;
                transition: color 0.1s;
            }

            .phantom-tab:hover    .phantom-tab-title { color: rgba(255,255,255,0.9); }
            .phantom-tab.selected .phantom-tab-title {
                color: #fff;
                font-weight: 500;
            }

            .phantom-tab-spinner {
                width: 13px;
                height: 13px;
                border: 2px solid rgba(255,255,255,0.1);
                border-top-color: #818cf8;
                border-radius: 50%;
                animation: phantom-spin 0.65s linear infinite;
                flex-shrink: 0;
            }

            @keyframes phantom-spin { to { transform: rotate(360deg); } }

            .phantom-tab-close {
                width: 20px;
                height: 20px;
                border: none;
                background: transparent;
                color: transparent;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                padding: 0;
                transition: background 0.1s, color 0.1s;
                margin-left: auto;
            }

            .phantom-tab:hover    .phantom-tab-close { color: rgba(255,255,255,0.45); }
            .phantom-tab-close:hover {
                background: rgba(255,75,75,0.22) !important;
                color: #ff8080 !important;
            }

            .collapsed .phantom-tab-title,
            .collapsed .phantom-tab-close { display: none; }
            .collapsed .phantom-tab { justify-content: center; padding: 0 5px; }
        `;
        document.head.appendChild(style);
    }

    // ─── Window controls ─────────────────────────────────

    function buildWinControls() {
        const wrap = document.createElement("div");
        wrap.id = "phantom-win-controls";

        // Попытка 1: перенести нативные кнопки Firefox (работает на X11/KDE/GNOME CSD)
        const native = document.querySelector(".titlebar-buttonbox-container");
        if (native) {
            wrap.appendChild(native);
            return wrap;
        }

        // Попытка 2: кастомные кнопки (для Wayland/Hyprland/тайловых WM)
        wrap.classList.add("custom-controls");

        const btns = [
            { id: "phantom-wc-close", title: "Close",    fn: () => window.close() },
            { id: "phantom-wc-min",   title: "Minimize", fn: () => window.minimize?.() },
            { id: "phantom-wc-max",   title: "Maximize", fn: () => {
                const S = window.STATE_MAXIMIZED ?? 1;
                if (window.windowState === S) window.restore?.();
                else window.maximize?.();
            }},
        ];

        for (const b of btns) {
            const btn = document.createElement("button");
            btn.id = b.id;
            btn.className = "phantom-wc";
            btn.title = b.title;
            btn.addEventListener("click", b.fn);
            wrap.appendChild(btn);
        }

        return wrap;
    }

    // ─── Build DOM ───────────────────────────────────────

    function buildSidebar() {
        sidebar = document.createElement("div");
        sidebar.id = "phantom-sidebar";

        // — Window controls (самый верх) —
        sidebar.appendChild(buildWinControls());

        // — Header —
        const header = document.createElement("div");
        header.id = "phantom-sidebar-header";

        const brand = document.createElement("div");
        brand.id = "phantom-brand";

        const brandMark = document.createElement("div");
        brandMark.id = "phantom-brand-mark";
        brandMark.textContent = "P";

        const brandName = document.createElement("div");
        brandName.id = "phantom-brand-name";
        brandName.textContent = "Phantom";

        brand.appendChild(brandMark);
        brand.appendChild(brandName);

        const collapseBtn = document.createElement("button");
        collapseBtn.id = "phantom-collapse-btn";
        collapseBtn.title = "Collapse sidebar (Ctrl+B)";
        collapseBtn.textContent = "‹";
        collapseBtn.addEventListener("click", toggleCollapse);

        header.appendChild(brand);
        header.appendChild(collapseBtn);
        sidebar.appendChild(header);

        // — Spaces —
        const spacesSection = document.createElement("div");
        spacesSection.id = "phantom-spaces-section";

        // Шапка секции spaces: "SPACES" + кнопка "+"
        const spacesHeader = document.createElement("div");
        spacesHeader.id = "phantom-spaces-header";

        const spacesLabel = document.createElement("div");
        spacesLabel.id = "phantom-spaces-label";
        spacesLabel.textContent = "Spaces";

        const addSpaceBtn = document.createElement("button");
        addSpaceBtn.id = "phantom-add-space-btn";
        addSpaceBtn.title = "New Space";
        addSpaceBtn.textContent = "+";
        addSpaceBtn.addEventListener("click", toggleAddSpaceForm);

        spacesHeader.appendChild(spacesLabel);
        spacesHeader.appendChild(addSpaceBtn);

        const spacesList = document.createElement("div");
        spacesList.id = "phantom-spaces-list";
        spacesContainer = spacesList;

        spacesSection.appendChild(spacesHeader);
        spacesSection.appendChild(spacesList);
        sidebar.appendChild(spacesSection);

        // — Divider —
        const div1 = document.createElement("div");
        div1.className = "phantom-divider";
        sidebar.appendChild(div1);

        // — Tabs (шапка: "TABS" + кнопка "+") —
        const tabsSection = document.createElement("div");
        tabsSection.id = "phantom-tabs-section";

        const tabsHeader = document.createElement("div");
        tabsHeader.id = "phantom-tabs-header";

        const tabsLabel = document.createElement("div");
        tabsLabel.id = "phantom-tabs-label";
        tabsLabel.textContent = "Tabs";

        const newTabBtn = document.createElement("button");
        newTabBtn.id = "phantom-new-tab-btn";
        newTabBtn.title = "New Tab (Ctrl+T)";
        newTabBtn.textContent = "+";
        newTabBtn.addEventListener("click", openNewTab);

        tabsHeader.appendChild(tabsLabel);
        tabsHeader.appendChild(newTabBtn);

        const tabsList = document.createElement("div");
        tabsList.id = "phantom-tabs-list";
        tabsContainer = tabsList;

        tabsSection.appendChild(tabsHeader);
        tabsSection.appendChild(tabsList);
        sidebar.appendChild(tabsSection);

        // — Вставляем sidebar В табконтейнер, рядом с контентом —
        // Правильная точка вставки: перед #appcontent внутри #tabbrowser-tabbox
        // Это не ломает URL-бар, который находится выше в #navigator-toolbox
        insertSidebar();
    }

    // ─── Add Space ───────────────────────────────────────

    const SPACE_PALETTE = [
        "#6C7AE0", "#E06C6C", "#6CE0A1", "#E0C56C",
        "#E08A6C", "#B76CE0", "#6CD4E0", "#E06CB7",
    ];

    // Заглушка — форма не нужна, buildSidebar её ждёт
    function buildAddSpaceForm() {
        const el = document.createElement("div");
        el.id = "phantom-add-space-form";
        return el;
    }

    async function toggleAddSpaceForm() {
        // Используем нативный prompt — гарантированно работает в chrome-контексте
        let name = "";
        try {
            const result = { value: "" };
            const ok = Services.prompt.prompt(
                window,
                "New Space",
                "Enter space name:",
                result,
                null,
                {}
            );
            if (!ok || !result.value.trim()) return;
            name = result.value.trim();
        } catch {
            // Fallback на window.prompt если Services.prompt недоступен
            const r = window.prompt("New space name:");
            if (!r || !r.trim()) return;
            name = r.trim();
        }

        const idx = phantomSpaces.allSpaces.length;
        const color = SPACE_PALETTE[idx % SPACE_PALETTE.length];

        try {
            const space = await phantomSpaces.createSpace(name, { color });
            switchSpace(space.id);
        } catch (e) {
            console.error("[Phantom] createSpace failed:", e);
        }
    }

    function insertSidebar() {
        // Вариант 1: рядом с #appcontent (лучший — URL-бар остаётся нетронутым)
        const appcontent = document.getElementById("appcontent");
        if (appcontent) {
            appcontent.parentNode.insertBefore(sidebar, appcontent);
            return;
        }

        // Вариант 2: внутри #tabbrowser-tabbox
        const tabbox = document.getElementById("tabbrowser-tabbox");
        if (tabbox) {
            tabbox.prepend(sidebar);
            return;
        }

        // Вариант 3: fallback — перед #browser в body
        const browser = document.getElementById("browser");
        if (browser) {
            // Принудительно делаем родителя flex-row
            const parent = browser.parentNode;
            parent.style.cssText += ";display:flex!important;flex-direction:row!important;";
            browser.style.cssText += ";flex:1!important;min-width:0!important;";
            parent.insertBefore(sidebar, browser);
        }
    }

    // Возвращает ID space для данной вкладки (атрибут phantom-space, по умолчанию "default")
    function getTabSpace(tab) {
        return tab.getAttribute("phantom-space") || "default";
    }

    // Присваивает вкладке текущее активное пространство
    function assignTabToActiveSpace(tab) {
        tab.setAttribute("phantom-space", phantomSpaces.activeSpaceId);
    }

    function openNewTab() {
        try {
            const newTab = window.gBrowser.addTab("about:newtab", {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
            assignTabToActiveSpace(newTab);
            window.gBrowser.selectedTab = newTab;
        } catch {
            if (window.BrowserOpenTab) window.BrowserOpenTab();
        }
    }

    // ─── Spaces ──────────────────────────────────────────

    function renderSpaces() {
        if (!spacesContainer) return;

        const spaces = phantomSpaces.allSpaces;
        const activeId = phantomSpaces.activeSpaceId;

        spacesContainer.innerHTML = "";

        spaces.forEach((space, i) => {
            const isActive = space.id === activeId;

            // Считаем вкладки этого space
            const count = Array.from(window.gBrowser.tabs)
                .filter(t => getTabSpace(t) === space.id).length;

            const item = document.createElement("div");
            item.className = "phantom-space-item" + (isActive ? " active" : "");
            item.title = `${space.name}  (Alt+${i + 1})`;

            const dot = document.createElement("div");
            dot.className = "phantom-space-dot";
            dot.style.background = space.color || "#6C7AE0";
            dot.style.color = "#fff";
            dot.textContent = (space.name || "?")[0].toUpperCase();

            const nameEl = document.createElement("div");
            nameEl.className = "phantom-space-name";
            nameEl.textContent = space.name;

            const countEl = document.createElement("div");
            countEl.className = "phantom-space-count";
            if (count > 0) countEl.textContent = String(count);

            item.appendChild(dot);
            item.appendChild(nameEl);
            item.appendChild(countEl);
            item.addEventListener("click", () => switchSpace(space.id));
            spacesContainer.appendChild(item);
        });
    }

    function switchSpace(spaceId) {
        phantomSpaces.switchTo(spaceId);

        // Показываем только вкладки этого space
        for (const tab of window.gBrowser.tabs) {
            if (getTabSpace(tab) === spaceId) {
                window.gBrowser.showTab(tab);
            } else {
                window.gBrowser.hideTab(tab);
            }
        }

        // Если в этом space нет вкладок — открываем новую
        const visible = Array.from(window.gBrowser.tabs).filter(t => !t.hidden);
        if (visible.length === 0) {
            const newTab = window.gBrowser.addTab("about:newtab", {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
            newTab.setAttribute("phantom-space", spaceId);
            window.gBrowser.selectedTab = newTab;
        } else if (window.gBrowser.selectedTab.hidden) {
            window.gBrowser.selectedTab = visible[0];
        }

        renderSpaces();
        renderTabs();
    }

    // ─── Tabs ─────────────────────────────────────────────

    function renderTabs() {
        if (!tabsContainer) return;

        const activeId = phantomSpaces.activeSpaceId;
        tabsContainer.innerHTML = "";

        for (const tab of window.gBrowser.tabs) {
            if (tab.hidden) continue;
            if (getTabSpace(tab) !== activeId) continue;

            const isSelected = tab === window.gBrowser.selectedTab;

            const el = document.createElement("div");
            el.className = "phantom-tab" + (isSelected ? " selected" : "");

            el.appendChild(buildFavicon(tab));

            const titleEl = document.createElement("div");
            titleEl.className = "phantom-tab-title";
            titleEl.textContent = tab.label || "New Tab";
            el.appendChild(titleEl);

            if (tab.hasAttribute("busy")) {
                const spinner = document.createElement("div");
                spinner.className = "phantom-tab-spinner";
                el.appendChild(spinner);
            } else {
                const closeBtn = document.createElement("button");
                closeBtn.className = "phantom-tab-close";
                closeBtn.title = "Close tab";
                closeBtn.textContent = "×";
                closeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    window.gBrowser.removeTab(tab, { animate: true });
                });
                el.appendChild(closeBtn);
            }

            el.addEventListener("click", () => { window.gBrowser.selectedTab = tab; });
            el.addEventListener("auxclick", (e) => {
                if (e.button === 1) window.gBrowser.removeTab(tab, { animate: true });
            });

            tabsContainer.appendChild(el);
        }
    }

    function buildFavicon(tab) {
        const icon = tab.getAttribute("image");
        if (icon && !icon.startsWith("chrome://mozapps") && !icon.startsWith("chrome://global")) {
            const img = document.createElement("img");
            img.className = "phantom-tab-favicon";
            img.src = icon;
            img.onerror = () => img.replaceWith(buildDefaultFavicon());
            return img;
        }
        return buildDefaultFavicon();
    }

    function buildDefaultFavicon() {
        const div = document.createElement("div");
        div.className = "phantom-tab-favicon-default";
        return div;
    }

    // ─── Collapse ─────────────────────────────────────────

    function toggleCollapse() {
        isCollapsed = !isCollapsed;
        sidebar.classList.toggle("collapsed", isCollapsed);
        try { Services.prefs.setBoolPref("phantom.sidebar.collapsed", isCollapsed); } catch {}
    }

    function restoreCollapseState() {
        try {
            isCollapsed = Services.prefs.getBoolPref("phantom.sidebar.collapsed", false);
            if (isCollapsed) sidebar.classList.add("collapsed");
        } catch {}
    }

    // ─── Events ──────────────────────────────────────────

    function watchTabs() {
        // При открытии новой вкладки — назначаем ей текущий space
        window.gBrowser.tabContainer.addEventListener("TabOpen", (e) => {
            const tab = e.target;
            // Назначаем только если атрибут не был задан явно (через openNewTab)
            if (!tab.hasAttribute("phantom-space")) {
                assignTabToActiveSpace(tab);
            }
            renderSpaces();
            renderTabs();
        });

        const rerender = () => { renderSpaces(); renderTabs(); };
        for (const ev of ["TabClose", "TabSelect", "TabAttrModified", "TabMove"]) {
            window.gBrowser.tabContainer.addEventListener(ev, rerender);
        }
    }

    function setupKeyboard() {
        window.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "b" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                toggleCollapse();
                return;
            }
            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
                e.preventDefault();
                const spaces = phantomSpaces.allSpaces;
                const idx = parseInt(e.key) - 1;
                if (idx < spaces.length) switchSpace(spaces[idx].id);
            }
        }, true);
    }

    // ─── Init ────────────────────────────────────────────

    async function init() {
        injectStyles();
        buildSidebar();

        await phantomSpaces.init();
        phantomSpaces.onChange(() => { renderSpaces(); renderTabs(); });

        renderSpaces();
        renderTabs();
        watchTabs();
        setupKeyboard();
        restoreCollapseState();

        window.PhantomVerticalTabs = { render: renderTabs, toggle: toggleCollapse };
        window.PhantomSpaces       = { switchTo: switchSpace };
    }

    if (document.readyState === "complete") init();
    else window.addEventListener("load", init, { once: true });
})();
