/**
 * Phantom Split View
 * Два сайта в одном окне с ресайзом разделителя
 * Ctrl+\
 */

"use strict";

(function PhantomSplitView() {
    let splitContainer = null;
    let isActive = false;
    let leftBrowser = null;
    let rightBrowser = null;

    function createSplitView() {
        const style = document.createElement("style");
        style.textContent = `
            #phantom-split-container {
                display: none;
                flex: 1;
                flex-direction: row;
                position: relative;
            }

            #phantom-split-container.active {
                display: flex;
            }

            .phantom-split-panel {
                flex: 1;
                display: flex;
                overflow: hidden;
                position: relative;
            }

            .phantom-split-panel browser {
                flex: 1;
            }

            .phantom-split-divider {
                width: 6px;
                background: #2a2a3e;
                cursor: col-resize;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                transition: background 0.15s;
            }

            .phantom-split-divider:hover {
                background: #6C7AE0;
            }

            .phantom-split-divider::after {
                content: '';
                width: 2px;
                height: 32px;
                background: rgba(255,255,255,0.15);
                border-radius: 1px;
            }

            .phantom-split-divider:hover::after {
                background: rgba(255,255,255,0.4);
            }

            .phantom-split-url-bar {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 32px;
                background: rgba(30, 30, 46, 0.95);
                display: flex;
                align-items: center;
                padding: 0 8px;
                gap: 6px;
                z-index: 10;
                border-bottom: 1px solid #333;
            }

            .phantom-split-url {
                flex: 1;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.1);
                color: #d4d4d8;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                outline: none;
            }

            .phantom-split-url:focus {
                border-color: #6C7AE0;
            }

            .phantom-split-close {
                background: transparent;
                border: none;
                color: #666;
                cursor: pointer;
                font-size: 14px;
                padding: 4px 8px;
            }

            .phantom-split-close:hover { color: #f04747; }
        `;
        document.head.appendChild(style);

        splitContainer = document.createElement("div");
        splitContainer.id = "phantom-split-container";

        const browserBox = document.getElementById("browser");
        if (browserBox) {
            browserBox.parentNode.insertBefore(splitContainer, browserBox.nextSibling);
        }
    }

    function activate() {
        if (!splitContainer) createSplitView();

        isActive = true;
        splitContainer.classList.add("active");
        splitContainer.innerHTML = "";

        // Текущая страница слева
        const currentUrl = window.gBrowser.selectedBrowser.currentURI.spec;

        // Левая панель
        const leftPanel = createPanel("left", currentUrl);
        const divider = createDivider();
        const rightPanel = createPanel("right", "about:newtab");

        splitContainer.appendChild(leftPanel);
        splitContainer.appendChild(divider);
        splitContainer.appendChild(rightPanel);

        // Скрываем основной контент
        const appcontent = document.getElementById("appcontent");
        if (appcontent) appcontent.style.display = "none";
    }

    function deactivate() {
        isActive = false;
        if (splitContainer) {
            splitContainer.classList.remove("active");
            splitContainer.innerHTML = "";
        }

        const appcontent = document.getElementById("appcontent");
        if (appcontent) appcontent.style.display = "";

        leftBrowser = null;
        rightBrowser = null;
    }

    function toggle() {
        if (isActive) deactivate();
        else activate();
    }

    function createPanel(side, url) {
        const panel = document.createElement("div");
        panel.className = "phantom-split-panel";

        // URL bar
        const urlBar = document.createElement("div");
        urlBar.className = "phantom-split-url-bar";

        const urlInput = document.createElement("input");
        urlInput.className = "phantom-split-url";
        urlInput.type = "text";
        urlInput.value = url;
        urlInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                let newUrl = urlInput.value.trim();
                if (!newUrl.includes("://")) newUrl = "https://" + newUrl;
                browser.loadURI(Services.io.newURI(newUrl), {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                });
            }
        });

        const closeBtn = document.createElement("button");
        closeBtn.className = "phantom-split-close";
        closeBtn.textContent = "x";
        closeBtn.title = "Close split view";
        closeBtn.addEventListener("click", deactivate);

        urlBar.appendChild(urlInput);
        urlBar.appendChild(closeBtn);

        // Browser frame
        const browser = document.createXULElement("browser");
        browser.setAttribute("type", "content");
        browser.setAttribute("remote", "true");
        browser.setAttribute("flex", "1");
        browser.style.marginTop = "32px";

        panel.appendChild(urlBar);
        panel.appendChild(browser);

        // Загружаем URL после добавления в DOM
        requestAnimationFrame(() => {
            try {
                browser.loadURI(Services.io.newURI(url), {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                });
            } catch (e) {
                console.debug("[SplitView] Load error:", e.message);
            }

            // Обновляем URL bar при навигации
            browser.addEventListener("pageshow", () => {
                try { urlInput.value = browser.currentURI.spec; } catch {}
            });
        });

        if (side === "left") leftBrowser = browser;
        else rightBrowser = browser;

        return panel;
    }

    function createDivider() {
        const divider = document.createElement("div");
        divider.className = "phantom-split-divider";

        let isDragging = false;

        divider.addEventListener("mousedown", (e) => {
            isDragging = true;
            e.preventDefault();
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging || !splitContainer) return;

            const rect = splitContainer.getBoundingClientRect();
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            const clamped = Math.max(20, Math.min(80, pct));

            const panels = splitContainer.querySelectorAll(".phantom-split-panel");
            if (panels.length === 2) {
                panels[0].style.flex = `0 0 ${clamped}%`;
                panels[1].style.flex = `0 0 ${100 - clamped}%`;
            }
        });

        window.addEventListener("mouseup", () => { isDragging = false; });

        return divider;
    }

    // ─── Shortcut Ctrl+\ ────────────────────────────────

    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
            e.preventDefault();
            toggle();
        }
    }, true);

    window.PhantomSplitView = { toggle, activate, deactivate };
})();
