/**
 * Phantom Proxy Manager — Browser Hook
 * UI управления прокси-серверами
 *
 * - Кнопка-глобус в тулбаре
 * - Панель: профили, быстрое переключение, тестирование, правила
 * - Ctrl+Shift+P: открыть панель
 * - Интеграция с ProxyFilter (работает совместно с DPI bypass)
 */

"use strict";

(function PhantomProxyHook() {

    const { phantomProxy } = ChromeUtils.importESModule(
        "resource://phantom/proxy/proxy-manager.sys.mjs"
    );

    let panelVisible = false;

    // ── Styles ──────────────────────────────────────────────────────────────

    const STYLES = `
        #phantom-proxy-btn {
            width: 32px; height: 32px; border: none; background: transparent;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            border-radius: 6px; transition: background 0.15s; margin: 0 2px;
        }
        #phantom-proxy-btn:hover { background: rgba(255,255,255,0.08); }
        #phantom-proxy-btn svg { width: 18px; height: 18px; transition: fill 0.2s, filter 0.2s; }
        #phantom-proxy-btn[data-state="active"] svg { fill: #60a5fa; filter: drop-shadow(0 0 4px rgba(96,165,250,0.5)); }
        #phantom-proxy-btn[data-state="disabled"] svg { fill: #6b7280; }
        #phantom-proxy-btn[data-state="error"] svg { fill: #f87171; }

        #phantom-proxy-panel {
            position: fixed; top: 48px; right: 100px; width: 400px; max-height: 600px;
            background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            z-index: 99998; display: none; flex-direction: column; overflow: hidden;
            font-family: -apple-system, "Segoe UI", sans-serif; color: #e2e8f0; font-size: 13px;
        }
        #phantom-proxy-panel.open { display: flex; }

        .proxy-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);
            background: rgba(255,255,255,0.02);
        }
        .proxy-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #f1f5f9; }

        .proxy-toggle {
            position: relative; width: 42px; height: 22px; border-radius: 11px;
            background: #374151; border: none; cursor: pointer; padding: 0; transition: background 0.2s;
        }
        .proxy-toggle.on { background: #3b82f6; }
        .proxy-toggle .knob {
            position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
            border-radius: 50%; background: #fff; transition: transform 0.2s;
        }
        .proxy-toggle.on .knob { transform: translateX(20px); }

        .proxy-body { padding: 12px 16px; overflow-y: auto; flex: 1; }

        .proxy-section { margin-bottom: 14px; }
        .proxy-section-title {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
            color: #94a3b8; margin-bottom: 8px; font-weight: 600;
        }

        .proxy-card {
            padding: 10px 12px; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; margin-bottom: 6px; cursor: pointer;
            transition: all 0.15s; display: flex; align-items: center; gap: 10px;
        }
        .proxy-card:hover { background: rgba(255,255,255,0.04); }
        .proxy-card.active { border-color: #3b82f6; background: rgba(59,130,246,0.06); }

        .proxy-card .indicator {
            width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .proxy-card .indicator.good { background: #4ade80; }
        .proxy-card .indicator.bad { background: #f87171; }
        .proxy-card .indicator.unknown { background: #6b7280; }

        .proxy-card .info { flex: 1; min-width: 0; }
        .proxy-card .info .name { font-weight: 500; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .proxy-card .info .addr { font-size: 11px; color: #64748b; margin-top: 2px; }

        .proxy-card .latency { font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; }
        .proxy-card .latency.fast { color: #4ade80; }
        .proxy-card .latency.medium { color: #facc15; }
        .proxy-card .latency.slow { color: #f87171; }

        .proxy-card .actions { display: flex; gap: 4px; }
        .proxy-card .action-btn {
            width: 24px; height: 24px; border: none; border-radius: 6px;
            background: rgba(255,255,255,0.04); color: #94a3b8;
            cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;
        }
        .proxy-card .action-btn:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }

        .proxy-direct-card {
            padding: 10px 12px; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; cursor: pointer; transition: all 0.15s;
            display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
        }
        .proxy-direct-card:hover { background: rgba(255,255,255,0.04); }
        .proxy-direct-card.active { border-color: #3b82f6; background: rgba(59,130,246,0.06); }

        .proxy-add-row { display: flex; gap: 6px; margin-top: 10px; }
        .proxy-input {
            flex: 1; padding: 7px 10px; border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px; background: rgba(255,255,255,0.03);
            color: #e2e8f0; font-size: 12px; outline: none;
        }
        .proxy-input:focus { border-color: rgba(59,130,246,0.4); }
        .proxy-input::placeholder { color: #4b5563; }

        .proxy-type-select {
            padding: 7px 10px; border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px; background: rgba(255,255,255,0.03);
            color: #e2e8f0; font-size: 12px; outline: none;
            appearance: none; -moz-appearance: none; cursor: pointer;
        }

        .proxy-btn-row { display: flex; gap: 6px; margin-top: 8px; }
        .proxy-btn {
            flex: 1; padding: 8px; border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px; background: rgba(255,255,255,0.03);
            color: #94a3b8; font-size: 12px; cursor: pointer; text-align: center;
        }
        .proxy-btn:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
        .proxy-btn.primary { border-color: rgba(59,130,246,0.3); color: #60a5fa; }

        .proxy-footer {
            padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.06);
            font-size: 11px; color: #4b5563; text-align: center;
        }

        .proxy-rule-row {
            display: flex; align-items: center; gap: 6px; padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 12px;
        }
        .proxy-rule-pattern { flex: 1; color: #94a3b8; font-family: monospace; }
        .proxy-rule-target { color: #60a5fa; }
        .proxy-rule-remove { cursor: pointer; color: #f87171; font-size: 14px; }
    `;

    const GLOBE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>`;

    // ── UI ──────────────────────────────────────────────────────────────────

    function setHTML(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        el.textContent = "";
        for (const child of [...doc.body.childNodes]) {
            el.appendChild(document.importNode(child, true));
        }
    }

    function createUI() {
        const styleEl = document.createElement("style");
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        createToolbarButton();
        createPanel();
    }

    function createToolbarButton() {
        const navbar = document.getElementById("nav-bar-customization-target") ||
                       document.getElementById("urlbar-container")?.parentElement;
        if (!navbar) return;

        const btn = document.createElement("button");
        btn.id = "phantom-proxy-btn";
        btn.setAttribute("data-state", phantomProxy.enabled && phantomProxy.activeProfile ? "active" : "disabled");
        btn.setAttribute("tooltiptext", "Phantom Proxy Manager (Ctrl+Shift+P)");
        setHTML(btn, GLOBE_SVG);
        btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });

        const dpiBtn = document.getElementById("phantom-dpi-btn");
        if (dpiBtn && dpiBtn.nextSibling) {
            navbar.insertBefore(btn, dpiBtn.nextSibling);
        } else {
            const spacer = navbar.querySelector("toolbarspring") || navbar.lastElementChild;
            navbar.insertBefore(btn, spacer);
        }
    }

    function createPanel() {
        const panel = document.createElement("div");
        panel.id = "phantom-proxy-panel";
        document.getElementById("browser")?.appendChild(panel) ||
            document.documentElement.appendChild(panel);

        panel.addEventListener("click", (e) => e.stopPropagation());
        document.addEventListener("click", (e) => {
            if (panelVisible && !e.target.closest("#phantom-proxy-btn")) {
                hidePanel();
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && panelVisible) hidePanel();
        });
    }

    function togglePanel() { panelVisible ? hidePanel() : showPanel(); }
    function showPanel() {
        const panel = document.getElementById("phantom-proxy-panel");
        if (!panel) return;
        renderPanel(); panel.classList.add("open"); panelVisible = true;
    }
    function hidePanel() {
        const panel = document.getElementById("phantom-proxy-panel");
        if (!panel) return;
        panel.classList.remove("open"); panelVisible = false;
    }

    function renderPanel() {
        const panel = document.getElementById("phantom-proxy-panel");
        if (!panel) return;

        const profiles = phantomProxy.getProfiles();
        const activeId = phantomProxy.activeProfileId;
        const rules = phantomProxy.getDomainRules();
        const stats = phantomProxy.stats;

        setHTML(panel, `
            <div class="proxy-header">
                <h3>Proxy Manager</h3>
                <button class="proxy-toggle ${phantomProxy.enabled ? 'on' : ''}" id="proxy-toggle-main">
                    <div class="knob"></div>
                </button>
            </div>

            <div class="proxy-body">
                <div class="proxy-section">
                    <div class="proxy-section-title">Connection</div>

                    <div class="proxy-direct-card ${!activeId ? 'active' : ''}" data-proxy-id="">
                        <div class="indicator good"></div>
                        <div class="info"><div class="name">Direct Connection</div>
                        <div class="addr">No proxy</div></div>
                    </div>

                    ${profiles.map(p => {
                        const isActive = p.id === activeId;
                        const latClass = p.latency < 0 ? "unknown" : p.latency < 200 ? "fast" : p.latency < 500 ? "medium" : "slow";
                        const indClass = p.latency < 0 ? "unknown" : p.failCount > 0 ? "bad" : "good";
                        const latText = p.latency < 0 ? "--" : `${p.latency}ms`;
                        return `
                        <div class="proxy-card ${isActive ? 'active' : ''}" data-proxy-id="${p.id}">
                            <div class="indicator ${indClass}"></div>
                            <div class="info">
                                <div class="name">${escapeHtml(p.name)}</div>
                                <div class="addr">${escapeHtml(p.type)}://${escapeHtml(p.host)}:${p.port}</div>
                            </div>
                            <span class="latency ${latClass}">${latText}</span>
                            <div class="actions">
                                <button class="action-btn test-btn" data-id="${p.id}" title="Test">&#9889;</button>
                                <button class="action-btn remove-btn" data-id="${p.id}" title="Remove">×</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <div class="proxy-section">
                    <div class="proxy-section-title">Add Proxy</div>
                    <div class="proxy-add-row">
                        <select class="proxy-type-select" id="proxy-add-type">
                            <option value="socks5">SOCKS5</option>
                            <option value="socks4">SOCKS4</option>
                            <option value="http">HTTP</option>
                            <option value="https">HTTPS</option>
                        </select>
                        <input type="text" class="proxy-input" id="proxy-add-host" placeholder="host:port" spellcheck="false" />
                    </div>
                    <div class="proxy-add-row" style="margin-top:6px">
                        <input type="text" class="proxy-input" id="proxy-add-user" placeholder="username (optional)" spellcheck="false" />
                        <input type="password" class="proxy-input" id="proxy-add-pass" placeholder="password (optional)" />
                    </div>
                    <div class="proxy-btn-row">
                        <button class="proxy-btn primary" id="proxy-add-btn">Add Proxy</button>
                        <button class="proxy-btn" id="proxy-import-btn">Import List</button>
                        <button class="proxy-btn" id="proxy-test-all-btn">Test All</button>
                    </div>
                </div>

                ${rules.length > 0 ? `
                <div class="proxy-section">
                    <div class="proxy-section-title">Domain Rules</div>
                    ${rules.map((r, i) => `
                        <div class="proxy-rule-row">
                            <span class="proxy-rule-pattern">${escapeHtml(r.pattern)}</span>
                            <span class="proxy-rule-target">${r.proxyId === 'direct' ? 'Direct' : (phantomProxy.getProfile(r.proxyId)?.name || r.proxyId)}</span>
                            <span class="proxy-rule-remove" data-rule-idx="${i}">×</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <div class="proxy-section">
                    <div class="proxy-section-title">Add Domain Rule</div>
                    <div class="proxy-add-row">
                        <input type="text" class="proxy-input" id="proxy-rule-pattern" placeholder="*.youtube.com" spellcheck="false" />
                        <select class="proxy-type-select" id="proxy-rule-target" style="min-width:100px">
                            <option value="direct">Direct</option>
                            ${profiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                        <button class="proxy-btn primary" id="proxy-rule-add" style="flex:0; padding:7px 14px">+</button>
                    </div>
                </div>
            </div>

            <div class="proxy-footer">
                Routed: ${stats.routed} · Direct: ${stats.direct} · ${profiles.length} proxies
            </div>
        `);

        // ── Events ──────────────────────────────────────────

        // Toggle
        panel.querySelector("#proxy-toggle-main")?.addEventListener("click", () => {
            phantomProxy.setEnabled(!phantomProxy.enabled);
            updateButtonState();
            renderPanel();
        });

        // Select proxy (click on card)
        panel.querySelectorAll("[data-proxy-id]").forEach(card => {
            card.addEventListener("click", (e) => {
                if (e.target.closest(".action-btn")) return;
                const id = card.getAttribute("data-proxy-id") || null;
                phantomProxy.setActive(id);
                updateButtonState();
                renderPanel();
            });
        });

        // Test
        panel.querySelectorAll(".test-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute("data-id");
                btn.textContent = "...";
                const result = await phantomProxy.testProxy(id);
                btn.textContent = result.ok ? `${result.latency}ms` : "FAIL";
                setTimeout(() => renderPanel(), 1500);
            });
        });

        // Remove
        panel.querySelectorAll(".remove-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                phantomProxy.removeProfile(btn.getAttribute("data-id"));
                updateButtonState();
                renderPanel();
            });
        });

        // Add proxy
        panel.querySelector("#proxy-add-btn")?.addEventListener("click", () => {
            const type = panel.querySelector("#proxy-add-type").value;
            const hostPort = panel.querySelector("#proxy-add-host").value.trim();
            const username = panel.querySelector("#proxy-add-user").value.trim();
            const password = panel.querySelector("#proxy-add-pass").value.trim();

            const [host, portStr] = hostPort.split(":");
            const port = parseInt(portStr, 10);

            if (host && port > 0 && port <= 65535) {
                phantomProxy.addProfile({
                    name: `${host}:${port}`,
                    type, host, port, username, password,
                });
                renderPanel();
            }
        });

        // Import
        panel.querySelector("#proxy-import-btn")?.addEventListener("click", () => {
            const input = { value: "" };
            const ok = Services.prompt.prompt(
                window, "Import Proxy List",
                "Paste proxy list (one per line):\nFormats: socks5://host:port, host:port, host:port:user:pass",
                input, null, { value: false }
            );
            if (ok && input.value) {
                const imported = phantomProxy.importList(input.value);
                showToast(`Imported ${imported.length} proxies`);
                renderPanel();
            }
        });

        // Test all
        panel.querySelector("#proxy-test-all-btn")?.addEventListener("click", async () => {
            const btn = panel.querySelector("#proxy-test-all-btn");
            if (btn) btn.textContent = "Testing...";
            await phantomProxy.testAllProxies();
            renderPanel();
        });

        // Add domain rule
        panel.querySelector("#proxy-rule-add")?.addEventListener("click", () => {
            const pattern = panel.querySelector("#proxy-rule-pattern").value.trim();
            const target = panel.querySelector("#proxy-rule-target").value;
            if (pattern) {
                phantomProxy.addDomainRule(pattern, target);
                renderPanel();
            }
        });

        // Remove domain rule
        panel.querySelectorAll(".proxy-rule-remove").forEach(el => {
            el.addEventListener("click", () => {
                phantomProxy.removeDomainRule(parseInt(el.getAttribute("data-rule-idx"), 10));
                renderPanel();
            });
        });
    }

    function updateButtonState() {
        const btn = document.getElementById("phantom-proxy-btn");
        if (!btn) return;
        if (!phantomProxy.enabled) { btn.setAttribute("data-state", "disabled"); return; }
        btn.setAttribute("data-state", phantomProxy.activeProfile ? "active" : "disabled");
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function showToast(message) {
        let toast = document.getElementById("phantom-proxy-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "phantom-proxy-toast";
            toast.style.cssText = `
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                padding: 10px 20px; background: #1a1a2e; color: #60a5fa;
                border: 1px solid rgba(96,165,250,0.2); border-radius: 8px;
                font-size: 13px; font-family: -apple-system, sans-serif;
                z-index: 999999; opacity: 0; transition: opacity 0.3s;
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            `;
            document.documentElement.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = "1";
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
    }

    // ── Keyboard ────────────────────────────────────────────────────────────

    function registerShortcut() {
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyP") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                togglePanel();
            }
        }, true);
    }

    // ── Init ────────────────────────────────────────────────────────────────

    async function init() {
        await phantomProxy.init();
        createUI();
        registerShortcut();
        console.log(`[Proxy] UI initialized — ${phantomProxy.getProfiles().length} profiles`);
    }

    window.addEventListener("unload", () => { phantomProxy.shutdown(); });

    window.PhantomProxy = {
        get manager() { return phantomProxy; },
        toggle() { phantomProxy.setEnabled(!phantomProxy.enabled); updateButtonState(); },
        add(type, host, port, user, pass) { return phantomProxy.addProfile({ name: `${host}:${port}`, type, host, port, username: user, password: pass }); },
    };

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });

})();
