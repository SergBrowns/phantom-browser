/**
 * Phantom AI Sidebar
 * Суммаризация, объяснение, перевод, вопросы по странице
 * Ctrl+Shift+A
 */

"use strict";

(function PhantomAISidebar() {
    const { phantomAI } = ChromeUtils.importESModule(
        "resource://phantom/ai/ai-provider.sys.mjs"
    );

    phantomAI.loadSettings();

    let sidebarPanel = null;
    let isOpen = false;

    // ─── AI Actions ─────────────────────────────────────

    const ACTIONS = {
        summarize: {
            label: "Summarize",
            icon: "S",
            system: "You summarize text concisely while preserving key points. Output in the same language as the input.",
            getUserMessage: (text) => `Summarize this:\n\n${text}`,
        },
        explain: {
            label: "Explain",
            icon: "E",
            system: "You explain text in simple terms, making complex concepts accessible. Use the same language as the input.",
            getUserMessage: (text) => `Explain this:\n\n${text}`,
        },
        translate: {
            label: "Translate",
            icon: "T",
            system: "You are a translator. Translate the text to the requested language. Only output the translation, nothing else.",
            getUserMessage: (text, lang) => `Translate to ${lang || "English"}:\n\n${text}`,
        },
        ask: {
            label: "Ask about page",
            icon: "?",
            system: "You answer questions about the provided text accurately and concisely. Use the same language as the question.",
            getUserMessage: (context, question) =>
                `Context:\n${context}\n\nQuestion: ${question}`,
        },
        compare: {
            label: "Compare",
            icon: "=",
            system: "You compare products/items based on the given information. Output a clear comparison table in markdown. Use the same language as the input.",
            getUserMessage: (text) => `Compare these items:\n\n${text}`,
        },
    };

    // ─── Sidebar UI ─────────────────────────────────────

    function createSidebar() {
        const style = document.createElement("style");
        style.textContent = `
            #phantom-ai-sidebar {
                display: none;
                width: 380px;
                min-width: 300px;
                max-width: 500px;
                background: #1e1e2e;
                border-left: 1px solid #333;
                flex-direction: column;
                font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
                font-size: 13px;
                color: #d4d4d8;
                position: relative;
            }

            #phantom-ai-sidebar.open { display: flex; }

            .phantom-ai-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid #333;
            }

            .phantom-ai-header h2 {
                font-size: 14px;
                font-weight: 600;
                color: #f0f0f0;
            }

            .phantom-ai-close {
                background: transparent;
                border: none;
                color: #888;
                cursor: pointer;
                font-size: 18px;
                padding: 4px;
            }

            .phantom-ai-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                padding: 12px 16px;
                border-bottom: 1px solid #333;
            }

            .phantom-ai-action-btn {
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.1);
                color: #d4d4d8;
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
            }

            .phantom-ai-action-btn:hover {
                background: rgba(255,255,255,0.12);
                border-color: rgba(255,255,255,0.2);
            }

            .phantom-ai-output {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                white-space: pre-wrap;
                line-height: 1.6;
            }

            .phantom-ai-output .loading {
                color: #666;
                font-style: italic;
            }

            .phantom-ai-output .error {
                color: #f04747;
            }

            .phantom-ai-input-wrap {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid #333;
            }

            .phantom-ai-input {
                flex: 1;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.1);
                color: #f0f0f0;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 13px;
                outline: none;
            }

            .phantom-ai-input:focus {
                border-color: #6C7AE0;
            }

            .phantom-ai-send {
                background: #6C7AE0;
                border: none;
                color: #fff;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
            }

            .phantom-ai-send:hover { background: #5a68c9; }

            .phantom-ai-provider-info {
                font-size: 10px;
                color: #555;
                text-align: center;
                padding: 4px;
                border-top: 1px solid #2a2a3a;
            }

            /* Resize handle */
            .phantom-ai-resize {
                position: absolute;
                left: 0; top: 0; bottom: 0;
                width: 4px;
                cursor: col-resize;
            }

            .phantom-ai-resize:hover { background: rgba(100,150,255,0.3); }
        `;
        document.head.appendChild(style);

        sidebarPanel = document.createElement("div");
        sidebarPanel.id = "phantom-ai-sidebar";

        // Header
        const header = document.createElement("div");
        header.className = "phantom-ai-header";
        header.innerHTML = `<h2>Phantom AI</h2>`;
        const closeBtn = document.createElement("button");
        closeBtn.className = "phantom-ai-close";
        closeBtn.textContent = "\u00d7";
        closeBtn.addEventListener("click", toggleSidebar);
        header.appendChild(closeBtn);

        // Actions
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "phantom-ai-actions";

        for (const [key, action] of Object.entries(ACTIONS)) {
            if (key === "ask") continue; // "ask" through input
            const btn = document.createElement("button");
            btn.className = "phantom-ai-action-btn";
            btn.textContent = `${action.icon} ${action.label}`;
            btn.addEventListener("click", () => runAction(key));
            actionsDiv.appendChild(btn);
        }

        // Output
        const output = document.createElement("div");
        output.className = "phantom-ai-output";
        output.id = "phantom-ai-output";

        // Input
        const inputWrap = document.createElement("div");
        inputWrap.className = "phantom-ai-input-wrap";

        const input = document.createElement("input");
        input.className = "phantom-ai-input";
        input.id = "phantom-ai-input";
        input.type = "text";
        input.placeholder = "Ask about this page...";

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && input.value.trim()) {
                runAction("ask", input.value.trim());
                input.value = "";
            }
        });

        const sendBtn = document.createElement("button");
        sendBtn.className = "phantom-ai-send";
        sendBtn.textContent = "Send";
        sendBtn.addEventListener("click", () => {
            if (input.value.trim()) {
                runAction("ask", input.value.trim());
                input.value = "";
            }
        });

        inputWrap.appendChild(input);
        inputWrap.appendChild(sendBtn);

        // Provider info
        const info = document.createElement("div");
        info.className = "phantom-ai-provider-info";
        info.id = "phantom-ai-provider-info";
        info.textContent = `Provider: ${phantomAI.providerName}`;

        // Resize handle
        const resize = document.createElement("div");
        resize.className = "phantom-ai-resize";
        setupResize(resize);

        sidebarPanel.appendChild(resize);
        sidebarPanel.appendChild(header);
        sidebarPanel.appendChild(actionsDiv);
        sidebarPanel.appendChild(output);
        sidebarPanel.appendChild(inputWrap);
        sidebarPanel.appendChild(info);

        // Insert next to browser
        const browserContainer = document.getElementById("browser");
        if (browserContainer) {
            browserContainer.parentNode.insertBefore(sidebarPanel, browserContainer.nextSibling);
        }
    }

    function setupResize(handle) {
        let isDragging = false;

        handle.addEventListener("mousedown", (e) => {
            isDragging = true;
            e.preventDefault();
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const rect = sidebarPanel.parentNode.getBoundingClientRect();
            const width = rect.right - e.clientX;
            sidebarPanel.style.width = `${Math.max(250, Math.min(600, width))}px`;
        });

        window.addEventListener("mouseup", () => { isDragging = false; });
    }

    // ─── Actions ────────────────────────────────────────

    async function runAction(actionKey, extra) {
        const output = document.getElementById("phantom-ai-output");

        if (!phantomAI.configured) {
            output.innerHTML = '<div class="error">AI not configured.\n\nGo to Settings \u2192 Phantom AI \u2192 Set your API key.\n\nSupported: Anthropic, OpenAI, Ollama (local)</div>';
            return;
        }

        const action = ACTIONS[actionKey];
        output.innerHTML = '<div class="loading">Thinking...</div>';

        try {
            const pageText = getPageText();

            let userMessage;
            if (actionKey === "ask") {
                userMessage = action.getUserMessage(pageText.substring(0, 12000), extra);
            } else if (actionKey === "translate") {
                const selectedText = getSelectedText() || pageText.substring(0, 8000);
                userMessage = action.getUserMessage(selectedText, extra || "English");
            } else {
                const selectedText = getSelectedText() || pageText.substring(0, 8000);
                userMessage = action.getUserMessage(selectedText);
            }

            const result = await phantomAI.complete(action.system, userMessage);
            output.textContent = result;

        } catch (e) {
            output.innerHTML = `<div class="error">Error: ${e.message}</div>`;
        }
    }

    function getPageText() {
        try {
            const browser = window.gBrowser.selectedBrowser;
            return browser.contentDocument.body.innerText || "";
        } catch {
            return "";
        }
    }

    function getSelectedText() {
        try {
            const browser = window.gBrowser.selectedBrowser;
            const selection = browser.contentWindow.getSelection();
            return selection ? selection.toString() : "";
        } catch {
            return "";
        }
    }

    // ─── Toggle ─────────────────────────────────────────

    function toggleSidebar() {
        if (!sidebarPanel) createSidebar();
        isOpen = !isOpen;
        sidebarPanel.classList.toggle("open", isOpen);

        if (isOpen) {
            const info = document.getElementById("phantom-ai-provider-info");
            if (info) info.textContent = `Provider: ${phantomAI.providerName}`;
        }
    }

    // ─── Context Menu ───────────────────────────────────

    function addContextMenu() {
        const contextMenu = document.getElementById("contentAreaContextMenu");
        if (!contextMenu) return;

        const separator = document.createXULElement("menuseparator");
        separator.id = "phantom-ai-context-sep";

        const menuItems = [
            { id: "phantom-ai-ctx-explain", label: "Phantom: Explain", action: "explain" },
            { id: "phantom-ai-ctx-summarize", label: "Phantom: Summarize", action: "summarize" },
            { id: "phantom-ai-ctx-translate", label: "Phantom: Translate", action: "translate" },
        ];

        contextMenu.appendChild(separator);

        for (const item of menuItems) {
            const mi = document.createXULElement("menuitem");
            mi.id = item.id;
            mi.setAttribute("label", item.label);
            mi.addEventListener("command", () => {
                if (!isOpen) toggleSidebar();
                runAction(item.action);
            });
            contextMenu.appendChild(mi);
        }

        // Show AI items only when text is selected
        contextMenu.addEventListener("popupshowing", () => {
            const hasSelection = !!getSelectedText();
            separator.hidden = !hasSelection;
            menuItems.forEach(item => {
                document.getElementById(item.id).hidden = !hasSelection;
            });
        });
    }

    // ─── Keyboard ───────────────────────────────────────

    window.addEventListener("keydown", (e) => {
        // Ctrl+Shift+A — AI Sidebar
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "A") {
            e.preventDefault();
            toggleSidebar();
        }
    }, true);

    window.addEventListener("load", () => {
        addContextMenu();
    }, { once: true });

    window.PhantomAI = { toggleSidebar, runAction };
})();
