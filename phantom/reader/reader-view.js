/**
 * Phantom Reader View
 * Чистый режим чтения с 4 темами, настройкой шрифта и ширины
 * Alt+R
 */

"use strict";

(function PhantomReaderView() {
    const { phantomReader } = ChromeUtils.importESModule(
        "resource://phantom/reader/reader-engine.sys.mjs"
    );

    let isActive = false;
    let originalContent = null;
    let settings = {
        theme: "dark",    // dark, light, sepia, paper
        fontSize: 18,
        lineHeight: 1.7,
        maxWidth: 680,
        fontFamily: "Georgia, 'Times New Roman', serif",
    };

    const THEMES = {
        dark:  { bg: "#1a1a2e", text: "#d4d4d8", heading: "#f0f0f0", link: "#7C8AE0", border: "#333" },
        light: { bg: "#ffffff", text: "#333333", heading: "#111111", link: "#2563eb", border: "#e5e5e5" },
        sepia: { bg: "#f4ecd8", text: "#5b4636", heading: "#3a2a1a", link: "#8b5e3c", border: "#d4c5a9" },
        paper: { bg: "#f8f5f0", text: "#444444", heading: "#222222", link: "#5a6fe0", border: "#ddd8d0" },
    };

    function toggle() {
        if (isActive) deactivate();
        else activate();
    }

    function activate() {
        const browser = window.gBrowser.selectedBrowser;
        const doc = browser.contentDocument;

        if (!doc || !doc.body) return;

        const article = phantomReader.extract(doc);
        if (!article) {
            console.log("[Reader] Page not suitable for reader mode");
            return;
        }

        // Сохраняем оригинал
        originalContent = doc.body.innerHTML;
        isActive = true;

        // Рендерим reader view
        renderReaderView(doc, article);
    }

    function deactivate() {
        if (!isActive) return;

        const browser = window.gBrowser.selectedBrowser;
        const doc = browser.contentDocument;

        if (doc && doc.body && originalContent !== null) {
            doc.body.innerHTML = originalContent;
            // Удаляем наш стиль
            const readerStyle = doc.getElementById("phantom-reader-style");
            if (readerStyle) readerStyle.remove();
        }

        originalContent = null;
        isActive = false;
    }

    function renderReaderView(doc, article) {
        const theme = THEMES[settings.theme];

        // Стиль
        let styleEl = doc.getElementById("phantom-reader-style");
        if (!styleEl) {
            styleEl = doc.createElement("style");
            styleEl.id = "phantom-reader-style";
            doc.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            * { margin: 0; padding: 0; box-sizing: border-box; }

            body {
                background: ${theme.bg} !important;
                color: ${theme.text} !important;
                font-family: ${settings.fontFamily} !important;
                font-size: ${settings.fontSize}px !important;
                line-height: ${settings.lineHeight} !important;
                padding: 0 !important;
            }

            .phantom-reader-container {
                max-width: ${settings.maxWidth}px;
                margin: 0 auto;
                padding: 48px 24px 96px;
            }

            .phantom-reader-toolbar {
                position: fixed;
                top: 16px;
                right: 16px;
                display: flex;
                gap: 4px;
                z-index: 10000;
                background: ${theme.bg};
                border: 1px solid ${theme.border};
                border-radius: 8px;
                padding: 4px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            }

            .phantom-reader-toolbar button {
                background: transparent;
                border: none;
                color: ${theme.text};
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
            }

            .phantom-reader-toolbar button:hover {
                background: rgba(128,128,128,0.15);
            }

            .phantom-reader-toolbar button.active {
                background: rgba(108, 122, 224, 0.2);
                color: #6C7AE0;
            }

            .phantom-reader-meta {
                margin-bottom: 32px;
                padding-bottom: 24px;
                border-bottom: 1px solid ${theme.border};
            }

            .phantom-reader-title {
                font-size: 2em;
                font-weight: 700;
                color: ${theme.heading};
                line-height: 1.2;
                margin-bottom: 12px;
            }

            .phantom-reader-byline {
                font-size: 0.85em;
                color: ${theme.text}99;
            }

            .phantom-reader-content p {
                margin-bottom: 1.2em;
            }

            .phantom-reader-content h1,
            .phantom-reader-content h2,
            .phantom-reader-content h3,
            .phantom-reader-content h4 {
                color: ${theme.heading};
                margin: 1.5em 0 0.5em;
                line-height: 1.3;
            }

            .phantom-reader-content h2 { font-size: 1.5em; }
            .phantom-reader-content h3 { font-size: 1.25em; }

            .phantom-reader-content a {
                color: ${theme.link};
                text-decoration: underline;
                text-decoration-thickness: 1px;
                text-underline-offset: 2px;
            }

            .phantom-reader-content img {
                max-width: 100%;
                height: auto;
                border-radius: 8px;
                margin: 16px 0;
            }

            .phantom-reader-content blockquote {
                border-left: 3px solid ${theme.link};
                padding-left: 16px;
                margin: 16px 0;
                font-style: italic;
                color: ${theme.text}cc;
            }

            .phantom-reader-content pre {
                background: rgba(0,0,0,0.1);
                padding: 16px;
                border-radius: 8px;
                overflow-x: auto;
                font-family: "Fira Code", "JetBrains Mono", monospace;
                font-size: 0.85em;
                line-height: 1.5;
                margin: 16px 0;
            }

            .phantom-reader-content code {
                font-family: "Fira Code", "JetBrains Mono", monospace;
                font-size: 0.9em;
                background: rgba(0,0,0,0.08);
                padding: 2px 5px;
                border-radius: 3px;
            }

            .phantom-reader-content ul,
            .phantom-reader-content ol {
                padding-left: 24px;
                margin-bottom: 1em;
            }

            .phantom-reader-content li {
                margin-bottom: 0.3em;
            }
        `;

        // Контент
        const byline = [article.byline, article.siteName].filter(Boolean).join(" · ");
        const readTime = article.estimatedReadTime;

        doc.body.innerHTML = `
            <div class="phantom-reader-toolbar" id="phantom-reader-toolbar">
                <button data-theme="dark" title="Dark theme">D</button>
                <button data-theme="light" title="Light theme">L</button>
                <button data-theme="sepia" title="Sepia theme">S</button>
                <button data-theme="paper" title="Paper theme">P</button>
                <button data-action="font-down" title="Smaller text">A-</button>
                <button data-action="font-up" title="Larger text">A+</button>
                <button data-action="width-down" title="Narrower">◁</button>
                <button data-action="width-up" title="Wider">▷</button>
                <button data-action="close" title="Exit reader">✕</button>
            </div>

            <div class="phantom-reader-container">
                <div class="phantom-reader-meta">
                    <h1 class="phantom-reader-title">${article.title}</h1>
                    ${byline ? `<div class="phantom-reader-byline">${byline} · ${readTime} min read</div>` : ""}
                </div>
                <div class="phantom-reader-content">
                    ${article.content}
                </div>
            </div>
        `;

        // Toolbar events
        const toolbar = doc.getElementById("phantom-reader-toolbar");
        toolbar.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;

            const theme = btn.dataset.theme;
            const action = btn.dataset.action;

            if (theme) {
                settings.theme = theme;
                renderReaderView(doc, article);
            }

            if (action === "font-up") {
                settings.fontSize = Math.min(28, settings.fontSize + 1);
                renderReaderView(doc, article);
            }
            if (action === "font-down") {
                settings.fontSize = Math.max(12, settings.fontSize - 1);
                renderReaderView(doc, article);
            }
            if (action === "width-up") {
                settings.maxWidth = Math.min(1000, settings.maxWidth + 60);
                renderReaderView(doc, article);
            }
            if (action === "width-down") {
                settings.maxWidth = Math.max(400, settings.maxWidth - 60);
                renderReaderView(doc, article);
            }
            if (action === "close") {
                deactivate();
            }
        });

        // Mark active theme button
        for (const btn of toolbar.querySelectorAll("[data-theme]")) {
            btn.classList.toggle("active", btn.dataset.theme === settings.theme);
        }
    }

    // ─── Shortcut Alt+R ─────────────────────────────────

    window.addEventListener("keydown", (e) => {
        if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "r") {
            e.preventDefault();
            toggle();
        }
    }, true);

    window.PhantomReader = { toggle, activate, deactivate };
})();
