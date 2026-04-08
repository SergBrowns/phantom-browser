/**
 * Phantom VPN — Browser Hook
 * UI for built-in VPN (sing-box backend)
 *
 * - Rocket button in toolbar
 * - Panel: server list, connect/disconnect, subscription, latency
 * - Ctrl+Shift+U: toggle panel
 * - Integrates with DPI proxy filter for IP-blocked domains
 */

"use strict";

(function PhantomVPNHook() {

    const { phantomVPN } = ChromeUtils.importESModule(
        "resource://phantom/vpn/vpn-engine.sys.mjs"
    );

    let panelVisible = false;

    // ── Styles ──────────────────────────────────────────────────────────────

    const STYLES = `
        #phantom-vpn-btn {
            width: 32px; height: 32px; border: none; background: transparent;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            border-radius: 6px; transition: background 0.15s; margin: 0 2px;
        }
        #phantom-vpn-btn:hover { background: rgba(255,255,255,0.08); }
        #phantom-vpn-btn svg { width: 18px; height: 18px; transition: fill 0.2s, filter 0.2s; }
        #phantom-vpn-btn[data-state="active"] svg { fill: #4ade80; filter: drop-shadow(0 0 4px rgba(74,222,128,0.5)); }
        #phantom-vpn-btn[data-state="routing"] svg { fill: #38bdf8; filter: drop-shadow(0 0 4px rgba(56,189,248,0.5)); }
        #phantom-vpn-btn[data-state="standby"] svg { fill: #facc15; filter: drop-shadow(0 0 3px rgba(250,204,21,0.3)); }
        #phantom-vpn-btn[data-state="connecting"] svg { fill: #facc15; filter: drop-shadow(0 0 4px rgba(250,204,21,0.4)); animation: vpn-pulse 1s infinite; }
        #phantom-vpn-btn[data-state="disconnected"] svg { fill: #6b7280; }
        #phantom-vpn-btn[data-state="error"] svg { fill: #f87171; }

        @keyframes vpn-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

        #phantom-vpn-panel {
            position: fixed; top: 48px; right: 20px; width: 380px; max-height: 600px;
            background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            z-index: 99997; display: none; flex-direction: column; overflow: hidden;
            font-family: -apple-system, "Segoe UI", sans-serif; color: #e2e8f0; font-size: 13px;
        }
        #phantom-vpn-panel.open { display: flex; }

        .vpn-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
        .vpn-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #f1f5f9; }

        .vpn-connect-btn { padding: 6px 16px; border-radius: 8px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .vpn-connect-btn.connect { background: #22c55e; color: #fff; }
        .vpn-connect-btn.connect:hover { background: #16a34a; }
        .vpn-connect-btn.disconnect { background: #ef4444; color: #fff; }
        .vpn-connect-btn.disconnect:hover { background: #dc2626; }
        .vpn-connect-btn.connecting { background: #eab308; color: #000; pointer-events: none; }

        .vpn-body { padding: 12px 16px; overflow-y: auto; flex: 1; }
        .vpn-section { margin-bottom: 14px; }
        .vpn-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 8px; font-weight: 600; }

        .vpn-server-card {
            padding: 10px 12px; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; margin-bottom: 6px; cursor: pointer;
            transition: all 0.15s; display: flex; align-items: center; gap: 10px;
        }
        .vpn-server-card:hover { background: rgba(255,255,255,0.04); }
        .vpn-server-card.active { border-color: #4ade80; background: rgba(74,222,128,0.06); }
        .vpn-server-card.selected { border-color: #3b82f6; background: rgba(59,130,246,0.06); }

        .vpn-server-flag { font-size: 20px; width: 28px; text-align: center; flex-shrink: 0; }
        .vpn-server-info { flex: 1; min-width: 0; }
        .vpn-server-name { font-weight: 500; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
        .vpn-server-addr { font-size: 11px; color: #64748b; margin-top: 1px; }

        .vpn-server-latency { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 48px; text-align: right; }
        .vpn-server-latency.fast { color: #4ade80; }
        .vpn-server-latency.medium { color: #facc15; }
        .vpn-server-latency.slow { color: #f87171; }
        .vpn-server-latency.unknown { color: #6b7280; }

        .vpn-status-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); margin-bottom: 12px; }
        .vpn-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .vpn-status-dot.on { background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.5); }
        .vpn-status-dot.off { background: #6b7280; }
        .vpn-status-dot.err { background: #f87171; }
        .vpn-status-text { flex: 1; font-size: 12px; color: #94a3b8; }
        .vpn-status-text strong { color: #e2e8f0; }

        .vpn-input { width: 100%; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #e2e8f0; font-size: 12px; outline: none; box-sizing: border-box; }
        .vpn-input:focus { border-color: rgba(74,222,128,0.3); }
        .vpn-input::placeholder { color: #4b5563; }

        .vpn-btn-row { display: flex; gap: 6px; margin-top: 8px; }
        .vpn-btn { flex: 1; padding: 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #94a3b8; font-size: 12px; cursor: pointer; text-align: center; }
        .vpn-btn:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
        .vpn-btn.primary { border-color: rgba(74,222,128,0.3); color: #4ade80; }

        .vpn-error { padding: 8px 12px; border-radius: 8px; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2); color: #f87171; font-size: 12px; margin-bottom: 10px; }

        .vpn-footer { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #4b5563; text-align: center; }
    `;

    const ROCKET_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.5c0 0-4.5 2.5-4.5 10.5L5 16l1.5 1.5L9 15c0 0 .5 3.5 3 5.5 2.5-2 3-5.5 3-5.5l2.5 2.5L19 16l-2.5-3C16.5 5 12 2.5 12 2.5zM12 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>`;

    // ── HTML helper ──────────────────────────────────────────────────────

    function setHTML(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        el.textContent = "";
        for (const child of [...doc.body.childNodes]) {
            el.appendChild(document.importNode(child, true));
        }
    }

    function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

    // ── UI ──────────────────────────────────────────────────────────────────

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
        btn.id = "phantom-vpn-btn";
        btn.setAttribute("data-state", "disconnected");
        btn.setAttribute("tooltiptext", "Phantom VPN (Ctrl+Shift+U)");
        setHTML(btn, ROCKET_SVG);
        btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });

        // Insert after proxy button or at end
        const proxyBtn = document.getElementById("phantom-proxy-btn");
        const dpiBtn = document.getElementById("phantom-dpi-btn");
        const ref = proxyBtn?.nextSibling || dpiBtn?.nextSibling || null;
        if (ref) navbar.insertBefore(btn, ref);
        else {
            const spacer = navbar.querySelector("toolbarspring") || navbar.lastElementChild;
            navbar.insertBefore(btn, spacer);
        }
    }

    function createPanel() {
        const panel = document.createElement("div");
        panel.id = "phantom-vpn-panel";
        document.getElementById("browser")?.appendChild(panel) ||
            document.documentElement.appendChild(panel);

        panel.addEventListener("click", (e) => e.stopPropagation());
        document.addEventListener("mousedown", (e) => {
            if (panelVisible &&
                !e.target.closest("#phantom-vpn-btn") &&
                !e.target.closest("#phantom-vpn-panel") &&
                !e.target.closest("menuitem") &&
                !e.target.closest("menupopup") &&
                !e.target.closest("[role='menuitem']")) {
                hidePanel();
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && panelVisible) hidePanel();
        });
    }

    function togglePanel() { panelVisible ? hidePanel() : showPanel(); }
    function showPanel() { const p = document.getElementById("phantom-vpn-panel"); if (!p) return; renderPanel(); p.classList.add("open"); panelVisible = true; }
    function hidePanel() { const p = document.getElementById("phantom-vpn-panel"); if (!p) return; p.classList.remove("open"); panelVisible = false; }

    function renderPanel() {
        const panel = document.getElementById("phantom-vpn-panel");
        if (!panel) return;

        const servers = phantomVPN.getServers();
        const active = phantomVPN.activeServer;
        const running = phantomVPN.running;
        const stats = phantomVPN.stats;
        const subUrl = phantomVPN.subscriptionUrl;

        const formatUptime = (ms) => {
            if (ms <= 0) return "--";
            const s = Math.floor(ms / 1000);
            const m = Math.floor(s / 60);
            const h = Math.floor(m / 60);
            if (h > 0) return `${h}h ${m % 60}m`;
            if (m > 0) return `${m}m ${s % 60}s`;
            return `${s}s`;
        };

        const connectBtnClass = running ? "disconnect" : "connect";
        const connectBtnText = running ? "Disconnect" : "Connect";

        setHTML(panel, `
            <div class="vpn-header">
                <h3>VPN</h3>
                <button class="vpn-connect-btn ${connectBtnClass}" id="vpn-toggle">${connectBtnText}</button>
            </div>

            <div class="vpn-body">
                <div class="vpn-status-bar">
                    <div class="vpn-status-dot ${running ? 'on' : phantomVPN.lastError ? 'err' : 'off'}"></div>
                    <div class="vpn-status-text">
                        ${running
                            ? `Connected to <strong>${esc(active?.name || '?')}</strong> · ${formatUptime(stats.uptime)}`
                            : phantomVPN.lastError
                                ? esc(phantomVPN.lastError)
                                : 'Disconnected'
                        }
                    </div>
                </div>

                ${!phantomVPN.singboxFound ? `
                <div class="vpn-error">
                    sing-box not found. Install: <code>sudo pacman -S sing-box</code>
                    or place binary in <code>~/.phantom/bin/sing-box</code>
                </div>` : ''}

                ${phantomVPN.lastError && !running ? `
                <div class="vpn-error">${esc(phantomVPN.lastError)}</div>` : ''}

                ${servers.length > 0 ? `
                <div class="vpn-section">
                    <div class="vpn-section-title">Servers (${servers.length})</div>
                    ${servers.map(s => {
                        const latClass = s.latency < 0 ? "unknown" : s.latency < 200 ? "fast" : s.latency < 500 ? "medium" : "slow";
                        const latText = s.latency < 0 ? "--" : `${s.latency}ms`;
                        const cardClass = s.active && running ? "active" : s.id === phantomVPN.activeServerId ? "selected" : "";
                        return `
                        <div class="vpn-server-card ${cardClass}" data-server-id="${esc(s.id)}">
                            <span class="vpn-server-flag">${s.flag || '🌐'}</span>
                            <div class="vpn-server-info">
                                <div class="vpn-server-name">${esc(s.name)}</div>
                                <div class="vpn-server-addr">${esc(s.server)}:${s.port} · ${esc(s.security || 'reality')}</div>
                            </div>
                            <span class="vpn-server-latency ${latClass}">${latText}</span>
                        </div>`;
                    }).join('')}
                </div>` : `
                <div class="vpn-section">
                    <div class="vpn-section-title">No Servers</div>
                    <div style="color:#64748b; font-size:12px;">Add a subscription URL or paste a VLESS link below.</div>
                </div>`}

                <div class="vpn-section">
                    <div class="vpn-section-title">Subscription</div>
                    <input type="text" class="vpn-input" id="vpn-sub-url" placeholder="https://your-provider.com/sub/..." value="${esc(subUrl)}" spellcheck="false" />
                    <div class="vpn-btn-row">
                        <button class="vpn-btn primary" id="vpn-sub-update">Update Servers</button>
                        <button class="vpn-btn" id="vpn-test-all">Test All</button>
                    </div>
                </div>

                <div class="vpn-section">
                    <div class="vpn-section-title">Add Server Manually</div>
                    <input type="text" class="vpn-input" id="vpn-manual-uri" placeholder="vless://uuid@host:port?..." spellcheck="false" />
                    <div class="vpn-btn-row">
                        <button class="vpn-btn" id="vpn-manual-add">Add</button>
                    </div>
                </div>

                <div class="vpn-section">
                    <div class="vpn-section-title">Kill Switch</div>
                    ${phantomVPN.killSwitchActive ? `
                    <div class="vpn-error" style="margin-bottom:8px;">⚠️ Kill Switch активен — трафик заблокирован. Подключитесь к VPN или выключите Kill Switch.</div>` : ''}
                    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;">
                        <input type="checkbox" id="vpn-killswitch" ${phantomVPN.killSwitch ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#4ade80;" />
                        <div>
                            <div style="font-size:12px;color:#e2e8f0;font-weight:500;">Блокировать трафик при падении VPN</div>
                            <div style="font-size:11px;color:#64748b;margin-top:2px;">Защита от утечек если соединение оборвётся</div>
                        </div>
                    </label>
                </div>
            </div>

            <div class="vpn-footer">
                Phantom VPN · sing-box backend · SOCKS5 :${phantomVPN.socksPort} · HTTP :${phantomVPN.httpPort}
            </div>
        `);

        // ── Events ──────────────────────────────────────────

        // Connect / Disconnect
        panel.querySelector("#vpn-toggle")?.addEventListener("click", async () => {
            const btn = panel.querySelector("#vpn-toggle");
            if (running) {
                if (btn) { btn.textContent = "..."; btn.className = "vpn-connect-btn connecting"; }
                await phantomVPN.disconnect();
            } else {
                if (btn) { btn.textContent = "Connecting..."; btn.className = "vpn-connect-btn connecting"; }
                await phantomVPN.connect(phantomVPN.activeServerId);
            }
            updateButtonState();
            renderPanel();
        });

        // Select server
        panel.querySelectorAll("[data-server-id]").forEach(card => {
            card.addEventListener("click", async () => {
                const serverId = card.getAttribute("data-server-id");
                if (running) {
                    // Switch server live
                    const btn = panel.querySelector("#vpn-toggle");
                    if (btn) { btn.textContent = "Switching..."; btn.className = "vpn-connect-btn connecting"; }
                    await phantomVPN.connect(serverId);
                } else {
                    // Just select
                    phantomVPN.connect(serverId); // This sets activeServerId and connects
                }
                updateButtonState();
                renderPanel();
            });
        });

        // Subscription update
        panel.querySelector("#vpn-sub-update")?.addEventListener("click", async () => {
            const urlInput = panel.querySelector("#vpn-sub-url");
            const btn = panel.querySelector("#vpn-sub-update");
            const url = urlInput?.value?.trim();
            if (!url) return;

            phantomVPN.setSubscriptionUrl(url);
            if (btn) btn.textContent = "Updating...";

            const result = await phantomVPN.updateSubscription();
            if (result.ok) {
                if (btn) btn.textContent = `${result.count} servers`;
            } else {
                if (btn) btn.textContent = "Failed";
                showToast(`Subscription error: ${result.error || "unknown"}`);
                console.error("[VPN] Subscription failed:", result.error);
            }
            setTimeout(() => renderPanel(), 1500);
        });

        // Test all
        panel.querySelector("#vpn-test-all")?.addEventListener("click", async () => {
            const btn = panel.querySelector("#vpn-test-all");
            if (btn) btn.textContent = "Testing...";
            await phantomVPN.testAllServers();
            renderPanel();
        });

        // Kill switch toggle
        panel.querySelector("#vpn-killswitch")?.addEventListener("change", (e) => {
            phantomVPN.setKillSwitch(e.target.checked);
            if (!e.target.checked) { updateButtonState(); renderPanel(); }
        });

        // Manual add
        panel.querySelector("#vpn-manual-add")?.addEventListener("click", () => {
            const input = panel.querySelector("#vpn-manual-uri");
            const uri = input?.value?.trim();
            if (!uri) return;
            const result = phantomVPN.addServer(uri);
            if (result) { if (input) input.value = ""; showToast(`Added: ${result.name}`); }
            else showToast("Invalid VLESS URI");
            renderPanel();
        });
    }

    // ── Button state ────────────────────────────────────────────────────

    function getCurrentHost() {
        try { return gBrowser.selectedBrowser.currentURI.host; } catch { return null; }
    }

    function updateButtonState() {
        const btn = document.getElementById("phantom-vpn-btn");
        if (!btn) return;

        if (!phantomVPN.running) {
            if (phantomVPN.killSwitchActive) {
                btn.setAttribute("data-state", "error");
                btn.setAttribute("tooltiptext", "Kill Switch активен — трафик заблокирован (Ctrl+Shift+U)");
            } else {
                btn.setAttribute("data-state", phantomVPN.lastError ? "error" : "disconnected");
                btn.setAttribute("tooltiptext", phantomVPN.lastError
                    ? `VPN: ${phantomVPN.lastError}`
                    : "VPN отключён (Ctrl+Shift+U)");
            }
            return;
        }

        const host = getCurrentHost();
        if (!host) {
            btn.setAttribute("data-state", "active");
            btn.setAttribute("tooltiptext", "VPN подключён");
            return;
        }

        if (isRussianDomain(host)) {
            // Russian site → traffic goes DIRECT, VPN idle
            btn.setAttribute("data-state", "standby");
            btn.setAttribute("tooltiptext", `VPN: ${host} → DIRECT (RU)`);
        } else {
            // All non-Russian traffic → VPN
            btn.setAttribute("data-state", "active");
            btn.setAttribute("tooltiptext", `VPN: ${host} → VPN`);
        }
    }

    function registerTabListener() {
        gBrowser.tabContainer.addEventListener("TabSelect", () => updateButtonState());
        gBrowser.addTabsProgressListener({ onLocationChange() { updateButtonState(); } });
    }

    function showToast(message) {
        let toast = document.getElementById("phantom-vpn-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "phantom-vpn-toast";
            toast.style.cssText = `position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:10px 20px; background:#1a1a2e; color:#4ade80; border:1px solid rgba(74,222,128,0.2); border-radius:8px; font-size:13px; font-family:-apple-system,sans-serif; z-index:999999; opacity:0; transition:opacity 0.3s; box-shadow:0 8px 24px rgba(0,0,0,0.4);`;
            document.documentElement.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = "1";
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
    }

    // ── Keyboard ────────────────────────────────────────────────────────

    function registerShortcut() {
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyU") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                togglePanel();
            }
        }, true);
    }

    // ── Smart routing ──────────────────────────────────────────────────

    // Russian TLDs and known Russian domains — always DIRECT, never VPN
    const RU_TLDS = new Set([".ru", ".su", ".рф", ".xn--p1ai"]);
    const RU_DOMAINS = new Set([
        // Gov
        "gosuslugi.ru", "mos.ru", "nalog.gov.ru", "pfr.gov.ru", "cbr.ru",
        "kremlin.ru", "government.ru", "mvd.ru", "fsb.ru", "mil.ru",
        "esia.gosuslugi.ru", "lk.gosuslugi.ru", "pos.gosuslugi.ru",
        // Banks
        "sberbank.ru", "online.sberbank.ru", "vtb.ru", "gazprombank.ru",
        "tinkoff.ru", "alfa-bank.ru", "raiffeisen.ru",
        // Popular Russian services
        "yandex.ru", "yandex.net", "ya.ru", "mail.ru", "vk.com", "vk.ru",
        "ok.ru", "avito.ru", "wildberries.ru", "ozon.ru", "kinopoisk.ru",
        "hh.ru", "dzen.ru", "rutube.ru", "ivi.ru", "2gis.ru",
        "ria.ru", "rbc.ru", "lenta.ru", "tass.ru", "rt.com",
        "megafon.ru", "mts.ru", "beeline.ru", "tele2.ru",
    ]);

    function isRussianDomain(host) {
        // Check TLD
        for (const tld of RU_TLDS) {
            if (host.endsWith(tld)) return true;
        }
        // Check exact or parent domain
        if (RU_DOMAINS.has(host)) return true;
        const parts = host.split(".");
        for (let i = 1; i < parts.length; i++) {
            if (RU_DOMAINS.has(parts.slice(i).join("."))) return true;
        }
        return false;
    }

    // CDN/dynamic subdomains — never auto-mark as IP-blocked (they rotate IPs)
    const CDN_PATTERNS = [
        /^rr\d+---.*\.googlevideo\.com$/,   // YouTube CDN nodes
        /^.*\.ggpht\.com$/,                  // Google image CDN
        /^.*\.googleusercontent\.com$/,      // Google user content
        /^.*\.gstatic\.com$/,                // Google static assets
        /^.*\.cdninstagram\.com$/,
        /^.*\.fbcdn\.net$/,
        /^.*\.akamaihd\.net$/,
        /^.*\.cloudfront\.net$/,
        /^.*\.fastly\.net$/,
    ];

    function isCdnSubdomain(host) {
        return CDN_PATTERNS.some(p => p.test(host));
    }

    // Auto-add IP-blocked domain silently (no dialog) and route via VPN
    function autoMarkIpBlocked(host) {
        window.PhantomDPI?.markIpBlocked(host);
        showToast(`${host} → VPN (IP-блокировка)`);
    }

    // Track connection failures for auto IP-block detection
    const failureTracker = new Map(); // host → { count, lastTime }
    const FAILURE_THRESHOLD = 3;      // failures before marking IP-blocked
    const FAILURE_WINDOW = 60000;     // 1 minute window

    function trackConnectionFailure(host) {
        const now = Date.now();
        const entry = failureTracker.get(host) || { count: 0, lastTime: 0 };

        // Reset if outside window
        if (now - entry.lastTime > FAILURE_WINDOW) {
            entry.count = 0;
        }

        entry.count++;
        entry.lastTime = now;
        failureTracker.set(host, entry);

        // Notify user when IP-block suspected — let them confirm before adding
        if (entry.count >= FAILURE_THRESHOLD && !isRussianDomain(host) && !isCdnSubdomain(host)) {
            const dpiEngine = window.PhantomDPI;
            if (dpiEngine && !dpiEngine.isIpBlocked(host)) {
                failureTracker.delete(host);
                autoMarkIpBlocked(host);
            }
        }
    }

    /**
     * Smart proxy filter:
     *   Russian domains   → DIRECT (no proxy, no VPN)
     *   IP-blocked        → VPN SOCKS5 (if connected)
     *   SNI-blocked       → DPI proxy (handled by DPI filter, we don't touch)
     *   Everything else   → DIRECT
     *
     * Runs AFTER DPI filter (priority 10). DPI filter sets proxy for
     * SNI-blocked domains. We override only for IP-blocked and Russian.
     */
    function registerVpnProxyFilter() {
        const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"]
            .getService(Ci.nsIProtocolProxyService);

        const vpnProxyFilter = {
            applyFilter(channel, defaultProxyInfo, callback) {
                try {
                    const host = channel.URI.host;
                    const scheme = channel.URI.scheme;

                    if (scheme !== "http" && scheme !== "https") {
                        callback.onProxyFilterResult(defaultProxyInfo);
                        return;
                    }

                    // Skip local
                    if (host === "127.0.0.1" || host === "localhost" || host === "::1" ||
                        host.endsWith(".local") || host.endsWith(".internal")) {
                        callback.onProxyFilterResult(defaultProxyInfo);
                        return;
                    }

                    // 1. Kill switch: VPN dropped unexpectedly → block all traffic
                    if (phantomVPN.killSwitchActive) {
                        // Route to port 1 — always refused, effectively blocks the request
                        const blockProxy = pps.newProxyInfo(
                            "socks", "127.0.0.1", 1,
                            "", "", Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST,
                            4294967295, null
                        );
                        callback.onProxyFilterResult(blockProxy);
                        return;
                    }

                    // 2. Russian domains → DIRECT always
                    if (isRussianDomain(host)) {
                        callback.onProxyFilterResult(null);
                        return;
                    }

                    // 3. VPN running → route ALL non-Russian traffic through VPN
                    //    VPN tunnel is encrypted — no need for DPI bypass, sing-box handles everything
                    if (phantomVPN.running) {
                        const proxyInfo = pps.newProxyInfo(
                            "socks", "127.0.0.1", phantomVPN.socksPort,
                            "", "", Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST,
                            4294967295, null
                        );
                        callback.onProxyFilterResult(proxyInfo);
                        return;
                    }

                    // 4. Otherwise — keep DPI filter's decision (defaultProxyInfo)
                    callback.onProxyFilterResult(defaultProxyInfo);
                } catch {
                    callback.onProxyFilterResult(defaultProxyInfo);
                }
            }
        };

        // Priority 10 — runs after DPI filter (priority 0)
        pps.registerChannelFilter(vpnProxyFilter, 10);
        console.log("[VPN] Smart proxy filter registered (priority 10)");

        // Kill switch observer — notify user when VPN drops and traffic is blocked
        Services.obs.addObserver({
            observe() {
                updateButtonState();
                showToast("⚠️ VPN упал — Kill Switch активирован. Трафик заблокирован.");
                if (panelVisible) renderPanel();
            }
        }, "phantom-vpn-killswitch-activated");
    }

    /**
     * Monitor connection errors to auto-detect IP-blocked sites.
     * When a DPI-proxied connection fails repeatedly → mark as IP-blocked.
     */
    function registerFailureDetector() {
        const observer = {
            observe(subject, topic) {
                try {
                    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
                    const host = channel.URI.host;

                    // Only care about domains that are in DPI block list but NOT yet IP-blocked
                    if (!window.PhantomDPI) return;
                    const dpi = window.PhantomDPI;
                    if (!dpi.isBlocked?.(host) || dpi.isIpBlocked(host)) return;
                    if (isRussianDomain(host)) return;

                    // Check for connection-reset / timeout indicators
                    try {
                        const status = channel.responseStatus;
                        // If we get a normal response, domain works through DPI — reset failures
                        if (status >= 200 && status < 400) {
                            failureTracker.delete(host);
                        }
                    } catch {
                        // Can't get responseStatus = connection failed
                        trackConnectionFailure(host);
                    }
                } catch {}
            }
        };

        Services.obs.addObserver(observer, "http-on-examine-response");
        Services.obs.addObserver({
            observe(subject) {
                try {
                    const channel = subject.QueryInterface(Ci.nsIChannel);
                    const host = channel.URI?.host;
                    if (!host) return;

                    // Only track failures for domains in the DPI block list
                    const dpi = window.PhantomDPI;
                    if (!dpi?.isBlocked?.(host) || dpi.isIpBlocked(host)) return;
                    if (isRussianDomain(host)) return;

                    // Check if the request actually failed (not just completed)
                    try {
                        const httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
                        const status = httpChannel.responseStatus;
                        // Successful response — don't count as failure
                        if (status >= 200 && status < 400) {
                            failureTracker.delete(host);
                            return;
                        }
                    } catch {
                        // Can't get responseStatus = connection-level failure
                        trackConnectionFailure(host);
                    }
                } catch {}
            }
        }, "http-on-stop-request");

        console.log("[VPN] Connection failure detector active");
    }

    // ── Init ────────────────────────────────────────────────────────────

    async function init() {
        await phantomVPN.init();
        createUI();
        registerShortcut();
        registerTabListener();
        registerVpnProxyFilter();
        registerFailureDetector();
        updateButtonState();

        console.log(`[VPN] UI initialized — ${phantomVPN.getServers().length} servers, sing-box=${phantomVPN.singboxFound ? 'OK' : 'NOT FOUND'}`);
        console.log("[VPN] Routing: RU domains → DIRECT | IP-blocked → VPN | SNI-blocked → DPI");
    }

    window.addEventListener("unload", () => { phantomVPN.shutdown(); });

    window.PhantomVPN = {
        get engine() { return phantomVPN; },
        async connect(id) { const ok = await phantomVPN.connect(id); updateButtonState(); return ok; },
        async disconnect() { await phantomVPN.disconnect(); updateButtonState(); },
        get running() { return phantomVPN.running; },
        get servers() { return phantomVPN.getServers(); },
        isRussianDomain,
    };

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });

})();
