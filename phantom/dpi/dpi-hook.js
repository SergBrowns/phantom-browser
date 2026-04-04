/**
 * Phantom DPI Bypass — Browser Hook v2
 *
 * v2 изменения:
 *   - Интеграция с Proxy Manager (chaining DPI → external proxy)
 *   - Content-sniffing: определение ISP block-page по заголовку страницы
 *   - Авто-reload при обнаружении блокировки
 *   - Bypass-all toggle в UI
 *   - QUIC management в UI
 *   - Расширенная статистика
 *   - Ctrl+Shift+D: панель
 */

"use strict";

(function PhantomDPIHook() {

    const { phantomDPI, STRATEGY, DOH_PROVIDERS, BLOCK_TITLE_PATTERNS } = ChromeUtils.importESModule(
        "resource://phantom/dpi/dpi-engine.sys.mjs"
    );
    const { phantomDPIProxy } = ChromeUtils.importESModule(
        "resource://phantom/dpi/dpi-proxy.sys.mjs"
    );
    const { rknSync } = ChromeUtils.importESModule(
        "resource://phantom/rkn/rkn-sync.sys.mjs"
    );

    let proxyFilterRegistered = false;
    let proxyFilter = null;
    let responseObserver = null;
    let panelVisible = false;

    // ── Styles ──────────────────────────────────────────────────────────────

    const STYLES = `
        #phantom-dpi-btn {
            position: relative; width: 32px; height: 32px; border: none; background: transparent;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            border-radius: 6px; transition: background 0.15s; margin: 0 2px;
        }
        #phantom-dpi-btn:hover { background: rgba(255,255,255,0.08); }
        #phantom-dpi-btn svg { width: 18px; height: 18px; transition: fill 0.2s, filter 0.2s; }
        #phantom-dpi-btn[data-state="active"] svg { fill: #4ade80; filter: drop-shadow(0 0 4px rgba(74,222,128,0.5)); }
        #phantom-dpi-btn[data-state="bypassing"] svg { fill: #facc15; filter: drop-shadow(0 0 4px rgba(250,204,21,0.4)); }
        #phantom-dpi-btn[data-state="disabled"] svg { fill: #6b7280; }
        #phantom-dpi-btn[data-state="error"] svg { fill: #f87171; filter: drop-shadow(0 0 4px rgba(248,113,113,0.5)); }
        #phantom-dpi-btn[data-state="bypass-all"] svg { fill: #a78bfa; filter: drop-shadow(0 0 4px rgba(167,139,250,0.5)); }

        #phantom-dpi-panel {
            position: fixed; top: 48px; right: 60px; width: 400px; max-height: 620px;
            background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            z-index: 99999; display: none; flex-direction: column; overflow: hidden;
            font-family: -apple-system, "Segoe UI", sans-serif; color: #e2e8f0; font-size: 13px;
        }
        #phantom-dpi-panel.open { display: flex; }

        .dpi-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
        .dpi-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #f1f5f9; }

        .dpi-toggle { position: relative; width: 42px; height: 22px; border-radius: 11px; background: #374151; border: none; cursor: pointer; padding: 0; transition: background 0.2s; }
        .dpi-toggle.on { background: #22c55e; }
        .dpi-toggle .dpi-toggle-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
        .dpi-toggle.on .dpi-toggle-knob { transform: translateX(20px); }

        .dpi-body { padding: 12px 16px; overflow-y: auto; flex: 1; }
        .dpi-section { margin-bottom: 14px; }
        .dpi-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 8px; font-weight: 600; }

        .dpi-stat-row { display: flex; justify-content: space-between; padding: 3px 0; }
        .dpi-stat-label { color: #94a3b8; }
        .dpi-stat-value { color: #e2e8f0; font-weight: 500; font-variant-numeric: tabular-nums; }
        .dpi-stat-value.green { color: #4ade80; }
        .dpi-stat-value.yellow { color: #facc15; }
        .dpi-stat-value.red { color: #f87171; }
        .dpi-stat-value.purple { color: #a78bfa; }

        .dpi-strategy-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
        .dpi-strategy-btn { padding: 8px 6px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #cbd5e1; font-size: 11px; cursor: pointer; text-align: center; transition: all 0.15s; }
        .dpi-strategy-btn:hover { background: rgba(255,255,255,0.06); }
        .dpi-strategy-btn.active { border-color: #4ade80; background: rgba(74,222,128,0.08); color: #4ade80; }

        .dpi-doh-select { width: 100%; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #e2e8f0; font-size: 12px; outline: none; cursor: pointer; appearance: none; -moz-appearance: none; }
        .dpi-doh-select:focus { border-color: rgba(74,222,128,0.4); }

        .dpi-domain-input-row { display: flex; gap: 6px; }
        .dpi-domain-input { flex: 1; padding: 7px 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; background: rgba(255,255,255,0.03); color: #e2e8f0; font-size: 12px; outline: none; }
        .dpi-domain-input:focus { border-color: rgba(74,222,128,0.3); }
        .dpi-domain-input::placeholder { color: #4b5563; }
        .dpi-domain-add-btn { padding: 7px 14px; border: 1px solid rgba(74,222,128,0.3); border-radius: 8px; background: rgba(74,222,128,0.08); color: #4ade80; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .dpi-domain-add-btn:hover { background: rgba(74,222,128,0.15); }

        .dpi-domain-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; margin: 2px; background: rgba(255,255,255,0.05); border-radius: 6px; font-size: 11px; color: #94a3b8; }
        .dpi-domain-tag .remove { cursor: pointer; color: #f87171; font-weight: bold; margin-left: 2px; }

        .dpi-current-site { display: flex; align-items: center; gap: 8px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
        .dpi-site-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dpi-site-status.bypassed { background: #4ade80; }
        .dpi-site-status.direct { background: #6b7280; }
        .dpi-site-hostname { flex: 1; font-size: 13px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dpi-site-action { padding: 4px 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: transparent; color: #94a3b8; font-size: 11px; cursor: pointer; }
        .dpi-site-action:hover { background: rgba(255,255,255,0.06); }

        .dpi-checkbox-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
        .dpi-checkbox { width: 16px; height: 16px; accent-color: #4ade80; cursor: pointer; }
        .dpi-checkbox-label { color: #94a3b8; font-size: 12px; cursor: pointer; }

        .dpi-footer { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #4b5563; text-align: center; }
    `;

    const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm0 2.18l7 3.82v4c0 4.52-3.13 8.69-7 9.93-3.87-1.24-7-5.41-7-9.93V8l7-3.82z"/>
        <path d="M12 7v10c2.76-.64 5-3.45 5-6.5V8.5L12 7z" opacity="0.6"/>
    </svg>`;

    // ── Proxy Filter (integrated with Proxy Manager) ────────────────────────

    function registerProxyFilter() {
        if (proxyFilterRegistered) return;

        const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"]
            .getService(Ci.nsIProtocolProxyService);

        proxyFilter = {
            applyFilter(channel, defaultProxyInfo, callback) {
                try {
                    if (!phantomDPI.enabled || !phantomDPIProxy.running) {
                        // Even if DPI is off, check if Proxy Manager wants to route
                        const proxyInfo = tryProxyManager(channel, pps, defaultProxyInfo);
                        callback.onProxyFilterResult(proxyInfo);
                        return;
                    }

                    const host = channel.URI.host;
                    const scheme = channel.URI.scheme;

                    if (scheme !== "http" && scheme !== "https") {
                        callback.onProxyFilterResult(defaultProxyInfo);
                        return;
                    }

                    if (host === "127.0.0.1" || host === "localhost" || host === "::1" ||
                        host.endsWith(".local") || host.endsWith(".internal")) {
                        callback.onProxyFilterResult(defaultProxyInfo);
                        return;
                    }

                    if (phantomDPI.isBlocked(host)) {
                        // IP-blocked domains need a real external proxy, not just DPI fragmentation
                        if (phantomDPI.isIpBlocked(host)) {
                            const extProxy = tryProxyManager(channel, pps, null);
                            if (extProxy) {
                                callback.onProxyFilterResult(extProxy);
                                return;
                            }
                            // No external proxy configured — fall through to DPI proxy anyway
                            // (won't help, but at least the connection attempt is visible in stats)
                        }
                        const proxyInfo = pps.newProxyInfo(
                            "http", "127.0.0.1", phantomDPIProxy.port,
                            "", "", 0, 4294967295, defaultProxyInfo
                        );
                        callback.onProxyFilterResult(proxyInfo);
                    } else {
                        phantomDPI.recordDirect();
                        // Non-blocked domain: check Proxy Manager
                        const proxyInfo = tryProxyManager(channel, pps, defaultProxyInfo);
                        callback.onProxyFilterResult(proxyInfo);
                    }
                } catch (e) {
                    callback.onProxyFilterResult(defaultProxyInfo);
                }
            }
        };

        pps.registerChannelFilter(proxyFilter, 0);
        proxyFilterRegistered = true;
        console.log("[DPI] Proxy filter registered");
    }

    /**
     * Проверяет, нужно ли направить через Proxy Manager
     */
    function tryProxyManager(channel, pps, defaultProxyInfo) {
        try {
            if (window.PhantomProxy && window.PhantomProxy.manager &&
                window.PhantomProxy.manager.enabled) {
                const host = channel.URI.host;
                const proxyInfo = window.PhantomProxy.manager.buildProxyInfo(host);
                if (proxyInfo) return proxyInfo;
            }
        } catch {}
        return defaultProxyInfo;
    }

    function unregisterProxyFilter() {
        if (!proxyFilterRegistered || !proxyFilter) return;
        try {
            Cc["@mozilla.org/network/protocol-proxy-service;1"]
                .getService(Ci.nsIProtocolProxyService)
                .unregisterChannelFilter(proxyFilter);
        } catch {}
        proxyFilterRegistered = false;
    }

    // ── Block page detection: HTTP response headers ─────────────────────────

    function registerResponseObserver() {
        responseObserver = {
            observe(subject, topic) {
                if (topic !== "http-on-examine-response") return;
                try {
                    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
                    const status = channel.responseStatus;
                    const originalHost = channel.URI.host;

                    // Skip if already bypassed
                    if (phantomDPI.isBlocked(originalHost)) return;

                    if (status >= 300 && status < 400) {
                        try {
                            const location = channel.getResponseHeader("Location");
                            if (location && phantomDPI.isBlockPage(location, null, null)) {
                                phantomDPI.addAutoDetected(originalHost);
                                console.log(`[DPI] Block redirect: ${originalHost} → ${location}`);
                            }
                        } catch {}
                    }

                    if (status === 200 || status === 403 || status === 451) {
                        try {
                            const ct = channel.getResponseHeader("Content-Type") || "";
                            if (ct.includes("text/html")) {
                                const cl = parseInt(channel.getResponseHeader("Content-Length") || "0", 10);
                                if (cl > 0 && cl < 51200 && phantomDPI.isBlockPage(channel.URI.spec, null, null)) {
                                    phantomDPI.addAutoDetected(originalHost);
                                }
                            }
                        } catch {}
                    }
                } catch {}
            }
        };
        Services.obs.addObserver(responseObserver, "http-on-examine-response");
    }

    // ── Block page detection: content sniffing (v2) ─────────────────────────

    function registerContentSniffing() {
        gBrowser.addTabsProgressListener({
            onStateChange(browser, webProgress, request, stateFlags) {
                if (!webProgress.isTopLevel) return;
                const STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP;
                const STATE_IS_NETWORK = Ci.nsIWebProgressListener.STATE_IS_NETWORK;
                if (!(stateFlags & STATE_STOP) || !(stateFlags & STATE_IS_NETWORK)) return;

                // Check page title after load
                setTimeout(() => checkForBlockPage(browser), 1500);
            }
        });
    }

    function checkForBlockPage(browser) {
        try {
            const doc = browser.contentDocument;
            if (!doc || !doc.title) return;

            const host = browser.currentURI.host;
            if (!host || phantomDPI.isBlocked(host)) return;

            // Check title against block page patterns
            if (phantomDPI.isBlockPageTitle(doc.title)) {
                phantomDPI.addAutoDetected(host);
                console.log(`[DPI] Block page detected by title: "${doc.title}" on ${host}`);

                // Show notification with offer to reload
                showBlockDetectedBanner(host);
            }
        } catch {}
    }

    function showBlockDetectedBanner(host) {
        let banner = document.getElementById("phantom-dpi-block-banner");
        if (banner) banner.remove();

        banner = document.createElement("div");
        banner.id = "phantom-dpi-block-banner";
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; padding: 10px 20px;
            background: linear-gradient(90deg, #1a1a2e, #16213e); color: #facc15;
            font-size: 13px; font-family: -apple-system, sans-serif;
            display: flex; align-items: center; justify-content: center; gap: 12px;
            z-index: 999999; border-bottom: 1px solid rgba(250,204,21,0.2);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        setHTML(banner, `
            <span>Block page detected for <strong>${esc(host)}</strong> - added to bypass list</span>
            <button id="dpi-block-reload" style="padding:4px 14px; border:1px solid rgba(74,222,128,0.4); border-radius:6px; background:rgba(74,222,128,0.1); color:#4ade80; cursor:pointer; font-size:12px;">Reload</button>
            <button id="dpi-block-dismiss" style="padding:4px 10px; border:none; background:transparent; color:#64748b; cursor:pointer; font-size:16px;">x</button>
        `);

        document.documentElement.appendChild(banner);

        banner.querySelector("#dpi-block-reload")?.addEventListener("click", () => {
            gBrowser.selectedBrowser.reload();
            banner.remove();
        });
        banner.querySelector("#dpi-block-dismiss")?.addEventListener("click", () => banner.remove());

        setTimeout(() => { try { banner.remove(); } catch {} }, 15000);
    }

    // ── HTML helper (XHTML-safe) ──────────────────────────────────────────

    function setHTML(el, html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
            "application/xhtml+xml"
        );
        const err = doc.querySelector("parsererror");
        if (err) {
            // Fallback: try as text/html
            const htmlDoc = parser.parseFromString(html, "text/html");
            el.textContent = "";
            for (const child of [...htmlDoc.body.childNodes]) {
                el.appendChild(document.importNode(child, true));
            }
            return;
        }
        el.textContent = "";
        for (const child of [...doc.documentElement.childNodes]) {
            el.appendChild(document.importNode(child, true));
        }
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    function createUI() {
        const styleEl = document.createElement("style");
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        createShieldButton();
        createPanel();
    }

    function createShieldButton() {
        const navbar = document.getElementById("nav-bar-customization-target") ||
                       document.getElementById("urlbar-container")?.parentElement;
        if (!navbar) return;

        const btn = document.createElement("button");
        btn.id = "phantom-dpi-btn";
        btn.setAttribute("tooltiptext", "Phantom DPI Bypass (Ctrl+Shift+D)");
        setHTML(btn, SHIELD_SVG);
        btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
        updateShieldState(btn);

        const spacer = navbar.querySelector("toolbarspring") || navbar.lastElementChild;
        navbar.insertBefore(btn, spacer);
    }

    function createPanel() {
        const panel = document.createElement("div");
        panel.id = "phantom-dpi-panel";
        document.getElementById("browser")?.appendChild(panel) || document.documentElement.appendChild(panel);

        panel.addEventListener("click", (e) => e.stopPropagation());
        document.addEventListener("click", (e) => {
            if (panelVisible && !e.target.closest("#phantom-dpi-btn")) hidePanel();
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panelVisible) hidePanel(); });
    }

    function togglePanel() { panelVisible ? hidePanel() : showPanel(); }
    function showPanel() { const p = document.getElementById("phantom-dpi-panel"); if (!p) return; renderPanel(); p.classList.add("open"); panelVisible = true; }
    function hidePanel() { const p = document.getElementById("phantom-dpi-panel"); if (!p) return; p.classList.remove("open"); panelVisible = false; }

    function renderPanel() {
        const panel = document.getElementById("phantom-dpi-panel");
        if (!panel) return;

        const stats = phantomDPI.stats;
        const currentHost = getCurrentHost();
        const isCurrentBlocked = currentHost ? phantomDPI.isBlocked(currentHost) : false;
        const isCurrentIpBlocked = currentHost ? phantomDPI.isIpBlocked(currentHost) : false;
        const currentDoh = phantomDPI.getCurrentDoh();
        const currentStrategy = phantomDPI.defaultStrategy;
        const userDomains = phantomDPI.getUserDomains();
        const userExceptions = phantomDPI.getUserExceptions();

        const strategyLabels = {
            [STRATEGY.SPLIT_SNI]:        "SNI Split",
            [STRATEGY.SPLIT_RECORD]:     "Record Split",
            [STRATEGY.MICRO_FRAG]:       "Micro Frag",
            [STRATEGY.TLS_RECORD_SPLIT]: "TLS Record",
            [STRATEGY.COMBO]:            "Combo",
            [STRATEGY.HOST_MIX]:         "Host Mix",
        };

        setHTML(panel, `
            <div class="dpi-header">
                <h3>DPI Bypass v2</h3>
                <button class="dpi-toggle ${phantomDPI.enabled ? 'on' : ''}" id="dpi-toggle-main"><div class="dpi-toggle-knob"></div></button>
            </div>

            <div class="dpi-body">
                ${currentHost ? `
                <div class="dpi-section">
                    <div class="dpi-section-title">Current Site</div>
                    <div class="dpi-current-site">
                        <div class="dpi-site-status ${isCurrentIpBlocked ? 'bypassed' : isCurrentBlocked ? 'bypassed' : 'direct'}" style="${isCurrentIpBlocked ? 'background:#f87171' : ''}"></div>
                        <span class="dpi-site-hostname">${esc(currentHost)}${isCurrentIpBlocked ? ' <span style="color:#f87171;font-size:11px">(IP-block)</span>' : ''}</span>
                        <button class="dpi-site-action" id="dpi-site-toggle">${isCurrentBlocked ? 'Exclude' : 'Add'}</button>
                        ${isCurrentBlocked && !isCurrentIpBlocked ? '<button class="dpi-site-action" id="dpi-site-ipblock" style="color:#f87171;border-color:rgba(248,113,113,0.3)">IP-block</button>' : ''}
                        ${isCurrentIpBlocked ? '<button class="dpi-site-action" id="dpi-site-unipblock" style="color:#94a3b8">Un-IP</button>' : ''}
                    </div>
                </div>` : ''}

                <div class="dpi-section">
                    <div class="dpi-section-title">Statistics</div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Domains</span><span class="dpi-stat-value">${stats.totalDomains.toLocaleString()}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Bypassed</span><span class="dpi-stat-value green">${stats.bypassed.toLocaleString()}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Direct</span><span class="dpi-stat-value">${stats.direct.toLocaleString()}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Auto-detected</span><span class="dpi-stat-value yellow">${stats.autoDetectedCount}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Strategy rotations</span><span class="dpi-stat-value purple">${stats.strategyRotations || 0}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Proxy</span><span class="dpi-stat-value">${phantomDPIProxy.running ? `:${phantomDPIProxy.port} (${phantomDPIProxy.connectionCount} conn)` : 'N/A'}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">Total connections</span><span class="dpi-stat-value">${phantomDPIProxy.totalConnections}</span></div>
                    <div class="dpi-stat-row"><span class="dpi-stat-label">DoH / TRR</span><span class="dpi-stat-value ${phantomDPI.trrVerified ? 'green' : 'yellow'}">${phantomDPI.trrVerified ? `Mode 3 (${currentDoh.name})` : `Mode ${phantomDPI.currentTrrMode} (fallback)`}</span></div>
                </div>

                <div class="dpi-section">
                    <div class="dpi-section-title">Strategy</div>
                    <div class="dpi-strategy-grid">
                        ${Object.entries(strategyLabels).map(([key, label]) => `
                            <button class="dpi-strategy-btn ${key === currentStrategy ? 'active' : ''}" data-strategy="${key}">${label}</button>
                        `).join('')}
                    </div>
                </div>

                <div class="dpi-section">
                    <div class="dpi-section-title">Options</div>
                    <div class="dpi-checkbox-row">
                        <input type="checkbox" class="dpi-checkbox" id="dpi-bypass-all" ${phantomDPI.bypassAll ? 'checked="checked"' : ''} />
                        <label class="dpi-checkbox-label" for="dpi-bypass-all">Bypass All (route everything through DPI proxy)</label>
                    </div>
                    <div class="dpi-checkbox-row">
                        <input type="checkbox" class="dpi-checkbox" id="dpi-quic-disable" ${phantomDPI.disableQuicForBlocked ? 'checked="checked"' : ''} />
                        <label class="dpi-checkbox-label" for="dpi-quic-disable">Disable QUIC (force TCP for fragmentation)</label>
                    </div>
                </div>

                <div class="dpi-section">
                    <div class="dpi-section-title">DNS over HTTPS</div>
                    <select class="dpi-doh-select" id="dpi-doh-select">
                        ${DOH_PROVIDERS.map(p => `<option value="${p.id}" ${p.id === currentDoh.id ? 'selected="selected"' : ''}>${p.name} (${p.bootstrap})</option>`).join('')}
                        <option value="custom">Custom...</option>
                    </select>
                </div>

                <div class="dpi-section">
                    <div class="dpi-section-title">Add Domain</div>
                    <div class="dpi-domain-input-row">
                        <input type="text" class="dpi-domain-input" id="dpi-domain-input" placeholder="example.com" spellcheck="false" />
                        <button class="dpi-domain-add-btn" id="dpi-domain-add">Add</button>
                    </div>
                    ${userDomains.length > 0 ? `<div style="margin-top:8px">${userDomains.map(d => `<span class="dpi-domain-tag">${esc(d)}<span class="remove" data-domain="${esc(d)}" data-action="remove-user">×</span></span>`).join('')}</div>` : ''}
                </div>

                ${userExceptions.length > 0 ? `
                <div class="dpi-section">
                    <div class="dpi-section-title">Exceptions</div>
                    <div>${userExceptions.map(d => `<span class="dpi-domain-tag">${esc(d)}<span class="remove" data-domain="${esc(d)}" data-action="remove-exception">×</span></span>`).join('')}</div>
                </div>` : ''}
            </div>

            <div class="dpi-footer" style="display:flex; align-items:center; justify-content:space-between;">
                <span>Phantom DPI v2 · ${stats.builtinCount} built-in + ${stats.remoteCount} remote</span>
                <button id="dpi-reverify-doh" style="padding:2px 8px; border:1px solid rgba(255,255,255,0.1); border-radius:4px; background:transparent; color:#94a3b8; font-size:10px; cursor:pointer;">Re-verify DoH</button>
            </div>
        `);

        // Events
        panel.querySelector("#dpi-toggle-main")?.addEventListener("click", () => {
            phantomDPI.setEnabled(!phantomDPI.enabled); updateShieldState(); renderPanel();
        });

        panel.querySelector("#dpi-site-toggle")?.addEventListener("click", () => {
            if (!currentHost) return;
            if (isCurrentBlocked) phantomDPI.addException(currentHost);
            else phantomDPI.addUserDomain(currentHost);
            updateShieldState(); renderPanel();
        });

        panel.querySelector("#dpi-site-ipblock")?.addEventListener("click", () => {
            if (!currentHost) return;
            phantomDPI.markIpBlocked(currentHost);
            showToast(`${currentHost}: marked as IP-blocked → needs external proxy`);
            renderPanel();
        });

        panel.querySelector("#dpi-site-unipblock")?.addEventListener("click", () => {
            if (!currentHost) return;
            phantomDPI.unmarkIpBlocked(currentHost);
            renderPanel();
        });

        panel.querySelectorAll(".dpi-strategy-btn").forEach(btn => {
            btn.addEventListener("click", () => { phantomDPI.setDefaultStrategy(btn.dataset.strategy); renderPanel(); });
        });

        panel.querySelector("#dpi-bypass-all")?.addEventListener("change", (e) => {
            phantomDPI.setBypassAll(e.target.checked); updateShieldState();
        });

        panel.querySelector("#dpi-quic-disable")?.addEventListener("change", (e) => {
            phantomDPI.setDisableQuic(e.target.checked);
        });

        panel.querySelector("#dpi-doh-select")?.addEventListener("change", (e) => {
            if (e.target.value !== "custom") phantomDPI.setDohProvider(e.target.value);
        });

        const domainInput = panel.querySelector("#dpi-domain-input");
        const doAdd = () => {
            const d = domainInput?.value?.trim().toLowerCase();
            if (d && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) {
                phantomDPI.addUserDomain(d); if (domainInput) domainInput.value = ""; renderPanel();
            }
        };
        panel.querySelector("#dpi-domain-add")?.addEventListener("click", doAdd);
        domainInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

        panel.querySelectorAll("[data-action='remove-user']").forEach(el => {
            el.addEventListener("click", () => { phantomDPI.removeUserDomain(el.dataset.domain); renderPanel(); });
        });
        panel.querySelectorAll("[data-action='remove-exception']").forEach(el => {
            el.addEventListener("click", () => { phantomDPI.removeException(el.dataset.domain); renderPanel(); });
        });

        panel.querySelector("#dpi-reverify-doh")?.addEventListener("click", async (e) => {
            const btn = e.target;
            btn.textContent = "Checking...";
            btn.disabled = true;
            const result = await phantomDPI.verifyAndUpgradeTrr();
            btn.textContent = result.ok ? "OK" : "Fallback";
            updateShieldState();
            setTimeout(() => renderPanel(), 1500);
        });
    }

    // ── Shield state ────────────────────────────────────────────────────────

    function updateShieldState(btnOverride) {
        const btn = btnOverride || document.getElementById("phantom-dpi-btn");
        if (!btn) return;

        if (!phantomDPI.enabled) { btn.setAttribute("data-state", "disabled"); return; }
        if (!phantomDPIProxy.running) { btn.setAttribute("data-state", "error"); return; }
        if (phantomDPI.bypassAll) { btn.setAttribute("data-state", "bypass-all"); return; }

        const host = getCurrentHost();
        btn.setAttribute("data-state", host && phantomDPI.isBlocked(host) ? "bypassing" : "active");
    }

    function getCurrentHost() { try { return gBrowser.selectedBrowser.currentURI.host; } catch { return null; } }
    function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

    function registerTabListener() {
        gBrowser.tabContainer.addEventListener("TabSelect", () => updateShieldState());
        gBrowser.addTabsProgressListener({ onLocationChange() { updateShieldState(); if (panelVisible) renderPanel(); } });
    }

    function registerShortcut() {
        // Use capture phase + code-based check to intercept before Firefox handles it
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                togglePanel();
            }
        }, true);
    }

    function showToast(message) {
        let toast = document.getElementById("phantom-dpi-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "phantom-dpi-toast";
            toast.style.cssText = `position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:10px 20px; background:#1a1a2e; color:#4ade80; border:1px solid rgba(74,222,128,0.2); border-radius:8px; font-size:13px; font-family:-apple-system,sans-serif; z-index:999999; opacity:0; transition:opacity 0.3s; box-shadow:0 8px 24px rgba(0,0,0,0.4);`;
            document.documentElement.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = "1";
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
    }

    // ── Init ────────────────────────────────────────────────────────────────

    async function init() {
        if (!Services.prefs.getBoolPref("phantom.dpi.enabled", true)) {
            console.log("[DPI] Module disabled");
            return;
        }

        await phantomDPI.init();

        // Уведомлять о каждом обновлении RKN (раз в час или при старте)
        rknSync.onUpdate(() => {
            showToast(`РКН: список обновлён — ${rknSync.domainCount.toLocaleString()} доменов`);
            if (panelVisible) renderPanel();
        });

        // Check if Proxy Manager has an active proxy → use as external chain
        let externalProxy = null;
        try {
            if (window.PhantomProxy?.manager?.enabled && window.PhantomProxy.manager.activeProfile) {
                const ap = window.PhantomProxy.manager.activeProfile;
                externalProxy = { type: ap.type, host: ap.host, port: ap.port };
            }
        } catch {}

        phantomDPIProxy.init(phantomDPI, externalProxy);

        if (!phantomDPIProxy.running) {
            console.error("[DPI] Proxy failed to start");
            return;
        }

        registerProxyFilter();
        registerResponseObserver();
        createUI();
        registerTabListener();
        registerShortcut();
        registerContentSniffing();

        console.log(`[DPI] v2 operational — proxy :${phantomDPIProxy.port}, ${phantomDPI.domainCount} domains, strategy=${phantomDPI.defaultStrategy}`);
        showToast(`DPI Bypass v2: ${phantomDPI.domainCount} domains protected`);

        // Verify DoH AFTER proxy filter is active — so the DoH connection
        // itself goes through DPI bypass (provider domains are in bypass list)
        phantomDPI.verifyAndUpgradeTrr().then(result => {
            if (result.ok) {
                console.log(`[DPI] DoH locked: ${result.provider.name}, TRR mode ${result.mode}`);
            } else {
                console.warn(`[DPI] DoH failed, using system DNS fallback (TRR mode ${result.mode})`);
                showToast("⚠ DoH unavailable — using system DNS fallback");
            }
            updateShieldState();
        }).catch(e => console.warn("[DPI] DoH verification error:", e.message));
    }

    window.addEventListener("unload", () => {
        unregisterProxyFilter();
        if (responseObserver) { try { Services.obs.removeObserver(responseObserver, "http-on-examine-response"); } catch {} }
        phantomDPIProxy.shutdown();
        phantomDPI.shutdown();
    });

    window.PhantomDPI = {
        get engine() { return phantomDPI; },
        get proxy() { return phantomDPIProxy; },
        toggle() { phantomDPI.setEnabled(!phantomDPI.enabled); updateShieldState(); showToast(phantomDPI.enabled ? "DPI Bypass ON" : "DPI Bypass OFF"); },
        addDomain(d) { phantomDPI.addUserDomain(d); },
        removeDomain(d) { phantomDPI.removeUserDomain(d); },
        isBlocked(d) { return phantomDPI.isBlocked(d); },
        markIpBlocked(d) { phantomDPI.markIpBlocked(d); },
        isIpBlocked(d) { return phantomDPI.isIpBlocked(d); },
    };

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });

})();
