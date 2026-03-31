/**
 * Phantom VPN Engine
 * Manages sing-box as a local SOCKS5/HTTP proxy backend for VLESS+REALITY
 *
 * Architecture:
 *   Browser ──► SOCKS5 127.0.0.1:10808 ──► sing-box ──► VLESS+REALITY ──► Internet
 *
 * Features:
 *   - Subscription URL parsing (base64 VLESS links)
 *   - sing-box process lifecycle management
 *   - Server latency testing
 *   - Auto-reconnect on failure
 *   - Config generation from parsed VLESS+REALITY URIs
 */

// Lazy-load Subprocess — path varies across Firefox versions
let _Subprocess = null;
function getSubprocess() {
    if (!_Subprocess) {
        try {
            ({ Subprocess: _Subprocess } = ChromeUtils.importESModule(
                "resource://gre/modules/Subprocess.sys.mjs"
            ));
        } catch {
            try {
                ({ Subprocess: _Subprocess } = ChromeUtils.importESModule(
                    "resource://gre/modules/Subprocess.jsm"
                ));
            } catch {
                // Last resort: Cu.import (older Gecko)
                const mod = ChromeUtils.import("resource://gre/modules/Subprocess.jsm");
                _Subprocess = mod.Subprocess;
            }
        }
    }
    return _Subprocess;
}

// Window-free fetch using XPCOM XMLHttpRequest (works in sys.mjs context)
function xhrFetch(url, { headers = {}, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        xhr.open("GET", url, true);
        xhr.timeout = timeout;
        xhr.responseType = "text";
        for (const [k, v] of Object.entries(headers)) {
            xhr.setRequestHeader(k, v);
        }
        xhr.addEventListener("load", () => {
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: () => Promise.resolve(xhr.responseText) });
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.addEventListener("timeout", () => reject(new Error("Timeout")));
        xhr.send();
    });
}

const SOCKS_PORT = 10808;
const HTTP_PORT = 10809;
const CONFIG_FILE = "phantom-vpn-singbox.json";
const CACHE_FILE = "phantom-vpn.json";
const SUBSCRIPTION_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours
const HEALTH_CHECK_INTERVAL = 60 * 1000;           // 1 min
const TEST_URL = "https://cp.cloudflare.com/";
const TEST_TIMEOUT = 10000;

// ── VLESS URI parser ───────────────────────────────────────────────────────

/**
 * Parses a VLESS URI into a server config object.
 * Format: vless://UUID@HOST:PORT?params#NAME
 */
function parseVlessUri(uri) {
    try {
        const match = uri.match(/^vless:\/\/([^@]+)@([^:]+):(\d+)\?(.+?)(?:#(.*))?$/);
        if (!match) return null;

        const uuid = match[1];
        const server = match[2];
        const port = parseInt(match[3], 10);
        const paramsStr = match[4];
        const name = match[5] ? decodeURIComponent(match[5]).trim() : `${server}:${port}`;

        const params = {};
        for (const pair of paramsStr.split("&")) {
            const [k, v] = pair.split("=");
            if (k && v !== undefined) params[k] = decodeURIComponent(v);
        }

        // Skip dummy entries (server 0.0.0.0)
        if (server === "0.0.0.0") return null;

        return {
            id: `${server}:${port}`,
            name,
            server,
            port,
            uuid,
            flow: params.flow || "",
            security: params.security || "",
            sni: params.sni || "",
            fingerprint: params.fp || "chrome",
            publicKey: params.pbk || "",
            shortId: params.sid || "",
            type: params.type || "tcp",
            headerType: params.headerType || "",
            path: params.path || "",
            host: params.host || "",
            latency: -1,
            lastTest: 0,
        };
    } catch {
        return null;
    }
}

/**
 * Detect country from server hostname or name
 */
function detectCountry(server) {
    const flags = {
        de: "🇩🇪", fi: "🇫🇮", lv: "🇱🇻", pl: "🇵🇱", fr: "🇫🇷",
        ee: "🇪🇪", ch: "🇨🇭", ru: "🇷🇺", tr: "🇹🇷", se: "🇸🇪",
        nl: "🇳🇱", us: "🇺🇸", gb: "🇬🇧", ua: "🇺🇦", kz: "🇰🇿",
        lt: "🇱🇹", bg: "🇧🇬", ro: "🇷🇴", at: "🇦🇹", it: "🇮🇹",
    };
    const hostPrefix = server.name?.split(".")[0]?.toLowerCase() ||
                       server.server?.split(".")[0]?.toLowerCase() || "";
    return flags[hostPrefix] || "";
}

// ── sing-box config generator ──────────────────────────────────────────────

function generateSingBoxConfig(server) {
    const config = {
        log: { level: "warn", timestamp: true },
        dns: {
            servers: [
                { tag: "bootstrap-dns", type: "udp", server: "94.140.14.14" },
                { tag: "doh", type: "https", server: "dns.adguard-dns.com", server_port: 443, domain_resolver: "bootstrap-dns" },
                { tag: "direct-dns", type: "local" },
            ],
            strategy: "prefer_ipv4",
        },
        inbounds: [
            {
                type: "socks",
                tag: "socks-in",
                listen: "127.0.0.1",
                listen_port: SOCKS_PORT,
            },
            {
                type: "http",
                tag: "http-in",
                listen: "127.0.0.1",
                listen_port: HTTP_PORT,
            },
        ],
        outbounds: [
            buildVlessOutbound(server),
            { type: "direct", tag: "direct", domain_resolver: "direct-dns" },
            { type: "block", tag: "block" },
        ],
        route: {
            auto_detect_interface: true,
            default_domain_resolver: "doh",
            rules: [
                { action: "sniff" },
                { protocol: "dns", action: "hijack-dns" },
                { ip_is_private: true, outbound: "direct" },
            ],
            final: "proxy",
        },
    };

    return config;
}

function buildVlessOutbound(server) {
    const outbound = {
        type: "vless",
        tag: "proxy",
        server: server.server,
        server_port: server.port,
        uuid: server.uuid,
    };

    if (server.flow) {
        outbound.flow = server.flow;
    }

    // TLS / REALITY
    if (server.security === "reality" || server.publicKey) {
        outbound.tls = {
            enabled: true,
            server_name: server.sni || server.server,
            reality: {
                enabled: true,
                public_key: server.publicKey,
                short_id: server.shortId || "",
            },
            utls: {
                enabled: true,
                fingerprint: server.fingerprint || "chrome",
            },
        };
    } else if (server.security === "tls") {
        outbound.tls = {
            enabled: true,
            server_name: server.sni || server.server,
            utls: {
                enabled: true,
                fingerprint: server.fingerprint || "chrome",
            },
        };
    }

    // Transport
    if (server.type === "ws") {
        outbound.transport = {
            type: "ws",
            path: server.path || "/",
            headers: server.host ? { Host: server.host } : {},
        };
    } else if (server.type === "grpc") {
        outbound.transport = {
            type: "grpc",
            service_name: server.path || "",
        };
    }

    return outbound;
}

// ── VPN Engine ─────────────────────────────────────────────────────────────

export class VPNEngine {
    #servers = [];
    #activeServerId = null;
    #process = null;
    #running = false;
    #enabled = false;
    #initialized = false;
    #subscriptionUrl = "";
    #subscriptionHwid = "";
    #singboxPath = "";
    #stats = { connected: 0, bytes: 0, uptime: 0 };
    #connectedSince = 0;
    #healthTimer = null;
    #subTimer = null;
    #configPath = "";
    #reconnecting = false;
    #lastError = "";

    async init() {
        this.#configPath = PathUtils.join(PathUtils.profileDir, CONFIG_FILE);

        // Find sing-box binary
        this.#singboxPath = await this.#findSingBox();
        if (!this.#singboxPath) {
            console.warn("[VPN] sing-box not found. Install it or place in ~/.phantom/bin/");
            this.#lastError = "sing-box not found";
        }

        await this.#loadCache();
        this.#initialized = true;

        // Schedule subscription updates
        this.#subTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        this.#subTimer.initWithCallback(
            () => this.updateSubscription().catch(() => {}),
            SUBSCRIPTION_INTERVAL,
            Ci.nsITimer.TYPE_REPEATING_SLACK
        );

        console.log(`[VPN] Initialized: ${this.#servers.length} servers, sing-box=${this.#singboxPath || 'NOT FOUND'}`);
    }

    // ── Getters ────────────────────────────────────────────────

    get initialized() { return this.#initialized; }
    get running() { return this.#running; }
    get enabled() { return this.#enabled; }
    get singboxFound() { return !!this.#singboxPath; }
    get lastError() { return this.#lastError; }
    get socksPort() { return SOCKS_PORT; }
    get httpPort() { return HTTP_PORT; }

    get activeServer() {
        if (!this.#activeServerId) return null;
        return this.#servers.find(s => s.id === this.#activeServerId) || null;
    }

    get activeServerId() { return this.#activeServerId; }

    get stats() {
        return {
            ...this.#stats,
            uptime: this.#connectedSince > 0 ? Date.now() - this.#connectedSince : 0,
            serverCount: this.#servers.length,
        };
    }

    get subscriptionUrl() { return this.#subscriptionUrl; }

    getServers() {
        return this.#servers.map(s => ({
            ...s,
            flag: detectCountry(s),
            active: s.id === this.#activeServerId,
        }));
    }

    getServer(id) {
        return this.#servers.find(s => s.id === id) || null;
    }

    // ── Subscription ───────────────────────────────────────────

    setSubscriptionUrl(url) {
        this.#subscriptionUrl = url;
        this.#saveCacheAsync();
    }

    async updateSubscription() {
        if (!this.#subscriptionUrl) return { ok: false, error: "No subscription URL" };

        try {
            // Generate stable UUID-format HWID from profile path
            if (!this.#subscriptionHwid) {
                const raw = PathUtils.profileDir;
                // Deterministic 128-bit hash → UUID v4 format
                let h1 = 0x9e3779b9, h2 = 0x6c62272e, h3 = 0x14c9f7e5, h4 = 0xf39cc0ad;
                for (let i = 0; i < raw.length; i++) {
                    const c = raw.charCodeAt(i);
                    h1 = Math.imul(h1 ^ c, 0x9e3779b9) >>> 0;
                    h2 = Math.imul(h2 ^ c, 0x85ebca77) >>> 0;
                    h3 = Math.imul(h3 ^ c, 0xc2b2ae3d) >>> 0;
                    h4 = Math.imul(h4 ^ c, 0x27d4eb2f) >>> 0;
                }
                const hex = n => n.toString(16).padStart(8, "0");
                // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
                const a = hex(h1), b = hex(h2), c = hex(h3), d = hex(h4);
                this.#subscriptionHwid = `${a}-${b.slice(0,4)}-4${b.slice(5,8)}-${((parseInt(c[0],16)&3)|8).toString(16)}${c.slice(1,4)}-${c.slice(4)}${d}`;
                this.#saveCacheAsync(); // save immediately so HWID stays stable across restarts
            }

            // Try with Hiddify UA first, fall back to plain UA if only dummy servers returned
            const fetchSub = (ua, extraHeaders = {}) => xhrFetch(this.#subscriptionUrl, {
                headers: { "User-Agent": ua, ...extraHeaders },
                timeout: 15000,
            });

            let response = await fetchSub(
                `HiddifyNext/2.5.1 (${this.#subscriptionHwid})`,
                { "X-HWID": this.#subscriptionHwid }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            let text = await response.text();
            let decoded = this.#tryBase64Decode(text) || text;
            let lines = decoded.split("\n").map(l => l.trim()).filter(Boolean);

            // If all servers are dummy (0.0.0.0), retry with plain User-Agent
            const realLines = lines.filter(l => l.startsWith("vless://") && !l.includes("@0.0.0.0:"));
            if (realLines.length === 0 && lines.length > 0) {
                console.log("[VPN] Only dummy entries with HiddifyNext UA, retrying with plain UA...");
                response = await fetchSub("Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0");
                if (response.ok) {
                    text = await response.text();
                    decoded = this.#tryBase64Decode(text) || text;
                    lines = decoded.split("\n").map(l => l.trim()).filter(Boolean);
                }
            }
            const servers = [];

            // Логируем только количество и протоколы — не содержимое (там могут быть токены/UUID)
            const detectedProtocols = new Set(lines.map(l => l.split("://")[0]).filter(p => p.length < 20));
            console.log(`[VPN] Subscription: ${lines.length} lines, protocols: ${[...detectedProtocols].join(", ")}`);

            for (const line of lines) {
                if (line.startsWith("vless://")) {
                    const parsed = parseVlessUri(line);
                    if (parsed) {
                        const existing = this.#servers.find(s => s.id === parsed.id);
                        if (existing) {
                            parsed.latency = existing.latency;
                            parsed.lastTest = existing.lastTest;
                        }
                        servers.push(parsed);
                    }
                }
                // TODO: vmess://, trojan://, ss:// support
            }

            if (servers.length === 0) {
                const protocols = [...detectedProtocols].join(", ") || "unknown";
                return { ok: false, error: `No VLESS servers found (got: ${protocols})` };
            }

            this.#servers = servers;
            await this.#saveCache();

            console.log(`[VPN] Subscription updated: ${servers.length} servers`);
            return { ok: true, count: servers.length };
        } catch (e) {
            console.warn(`[VPN] Subscription update failed: ${e.message}`);
            return { ok: false, error: e.message };
        }
    }

    #tryBase64Decode(text) {
        try {
            const normalized = text.trim().replace(/-/g, "+").replace(/_/g, "/");
            const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
            return atob(padded);
        } catch {
            return null;
        }
    }

    // ── Helpers ────────────────────────────────────────────────

    #delay(ms) {
        return new Promise(r => {
            const t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            t.initWithCallback(() => r(), ms, Ci.nsITimer.TYPE_ONE_SHOT);
        });
    }

    async #killAllSingbox() {
        // Kill by pkill (covers any orphan sing-box we spawned)
        try {
            const proc = await getSubprocess().call({
                command: "/usr/bin/pkill",
                arguments: ["-f", "sing-box.*phantom-vpn"],
                stderr: "pipe",
            });
            await proc.wait();
        } catch {}

        // Also kill anything holding our port
        try {
            const proc = await getSubprocess().call({
                command: "/usr/bin/fuser",
                arguments: ["-k", `${SOCKS_PORT}/tcp`],
                stderr: "pipe",
            });
            await proc.wait();
        } catch {}
    }

    async #waitPortFree(port, maxWait = 5000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            try {
                const proc = await getSubprocess().call({
                    command: "/usr/bin/fuser",
                    arguments: [`${port}/tcp`],
                    stderr: "pipe",
                });
                const result = await proc.wait();
                // fuser exits 0 if port is in use, 1 if free
                if (result.exitCode !== 0) return true; // port is free
            } catch {
                return true; // fuser failed = port likely free
            }
            await this.#delay(200);
        }
        return false;
    }

    // ── Connect / Disconnect ───────────────────────────────────

    async connect(serverId) {
        if (this.#reconnecting) return false;

        if (!this.#singboxPath) {
            this.#lastError = "sing-box binary not found";
            return false;
        }

        const server = serverId
            ? this.#servers.find(s => s.id === serverId)
            : this.#servers[0];

        if (!server) {
            this.#lastError = "No server selected";
            return false;
        }

        // Always disconnect first (handles orphans too)
        await this.disconnect();

        this.#activeServerId = server.id;
        this.#lastError = "";

        // Generate config
        const config = generateSingBoxConfig(server);
        const configJson = JSON.stringify(config, null, 2);

        try {
            await IOUtils.writeUTF8(this.#configPath, configJson);
        } catch (e) {
            this.#lastError = `Config write failed: ${e.message}`;
            return false;
        }

        // Start sing-box
        try {
            this.#process = await getSubprocess().call({
                command: this.#singboxPath,
                arguments: ["run", "-c", this.#configPath],
                stderr: "pipe",
                environment: {},
            });

            if (!this.#process) {
                this.#lastError = "Failed to spawn sing-box process";
                return false;
            }

            // Read stderr in background for errors
            this.#readStderr();

            // Wait for startup
            await this.#delay(1500);

            // Check if process is still alive
            const exitCode = await Promise.race([
                this.#process.wait(),
                this.#delay(500).then(() => null),
            ]);

            if (exitCode !== null) {
                this.#lastError = `sing-box exited (code ${exitCode.exitCode})`;
                this.#process = null;
                return false;
            }

            this.#running = true;
            this.#enabled = true;
            this.#connectedSince = Date.now();
            this.#stats.connected++;

            this.#startHealthCheck();
            await this.#saveCache();
            console.log(`[VPN] Connected to ${server.name} (${server.server}:${server.port})`);
            return true;
        } catch (e) {
            this.#lastError = `Failed to start sing-box: ${e.message}`;
            console.error(`[VPN] ${this.#lastError}`);
            this.#process = null;
            return false;
        }
    }

    async disconnect() {
        this.#stopHealthCheck();

        // 1. Try graceful shutdown of our tracked process
        if (this.#process) {
            // Try SIGTERM first, then SIGKILL
            for (const sig of [15, 9]) {
                try { this.#process.kill(sig); } catch {}
                try {
                    const result = await Promise.race([
                        this.#process.wait(),
                        this.#delay(1500).then(() => null),
                    ]);
                    if (result !== null) break; // exited
                } catch { break; }
            }
            this.#process = null;
        }

        // 2. Kill any orphan sing-box processes and wait for port to free
        await this.#killAllSingbox();
        await this.#waitPortFree(SOCKS_PORT, 5000);

        this.#running = false;
        this.#connectedSince = 0;
        console.log("[VPN] Disconnected");
    }

    async #readStderr() {
        if (!this.#process) return;
        try {
            const decoder = new TextDecoder();
            let chunk;
            while ((chunk = await this.#process.stderr.readString()) !== undefined) {
                if (chunk === null || chunk === "") break;
                const lines = chunk.split("\n").filter(Boolean);
                for (const line of lines) {
                    if (line.includes("error") || line.includes("fatal")) {
                        this.#lastError = line.trim();
                        console.warn(`[VPN/sing-box] ${line.trim()}`);
                    } else {
                        console.debug(`[VPN/sing-box] ${line.trim()}`);
                    }
                }
            }
        } catch {}
    }

    // ── Health check ───────────────────────────────────────────

    #startHealthCheck() {
        this.#stopHealthCheck();
        this.#healthTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        this.#healthTimer.initWithCallback(
            () => this.#checkHealth().catch(() => {}),
            HEALTH_CHECK_INTERVAL,
            Ci.nsITimer.TYPE_REPEATING_SLACK
        );
    }

    #stopHealthCheck() {
        if (this.#healthTimer) {
            this.#healthTimer.cancel();
            this.#healthTimer = null;
        }
    }

    async #checkHealth() {
        if (!this.#running) return;

        try {
            // Test connection through our SOCKS proxy
            const ok = await this.testConnectivity();
            if (!ok && !this.#reconnecting) {
                console.warn("[VPN] Health check failed, attempting reconnect...");
                this.#reconnecting = true;
                await this.disconnect();
                await this.connect(this.#activeServerId);
                this.#reconnecting = false;
            }
        } catch {
            this.#reconnecting = false;
        }
    }

    // ── Server testing ─────────────────────────────────────────

    async testServer(serverId) {
        const server = this.#servers.find(s => s.id === serverId);
        if (!server) return { ok: false, latency: -1 };

        const startTime = Date.now();
        try {
            // TCP connect test to server:port
            const sts = Cc["@mozilla.org/network/socket-transport-service;1"]
                .getService(Ci.nsISocketTransportService);
            const transport = sts.createTransport([], server.server, server.port, null, null);
            transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, 5);

            const connected = await new Promise((resolve) => {
                const output = transport.openOutputStream(0, 0, 0)
                    .QueryInterface(Ci.nsIAsyncOutputStream);
                output.asyncWait({
                    onOutputStreamReady() { resolve(true); }
                }, 0, 0, Services.tm.mainThread);

                const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
                timer.initWithCallback(() => resolve(false), 5000, Ci.nsITimer.TYPE_ONE_SHOT);
            });

            try { transport.close(Cr.NS_OK); } catch {}

            const latency = Date.now() - startTime;
            server.latency = connected ? latency : -1;
            server.lastTest = Date.now();
            this.#saveCacheAsync();

            return { ok: connected, latency: connected ? latency : -1 };
        } catch (e) {
            server.latency = -1;
            server.lastTest = Date.now();
            return { ok: false, latency: -1, error: e.message };
        }
    }

    async testAllServers() {
        const results = [];
        for (const server of this.#servers) {
            results.push({ id: server.id, ...(await this.testServer(server.id)) });
        }
        return results;
    }

    async testConnectivity() {
        try {
            const response = await xhrFetch(TEST_URL, { timeout: TEST_TIMEOUT });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ── Find sing-box binary ───────────────────────────────────

    async #findSingBox() {
        let homeDir = "";
        try {
            homeDir = Services.dirsvc.get("Home", Ci.nsIFile).path;
        } catch {}

        const candidates = [
            // Flatpak app directory
            "/app/bin/sing-box",
            "/app/lib/phantom/sing-box",
            // System — native package
            "/usr/bin/sing-box",
            "/usr/local/bin/sing-box",
            "/snap/bin/sing-box",
            // Profile-local
            PathUtils.join(PathUtils.profileDir, "sing-box"),
        ];
        if (homeDir) {
            candidates.push(
                PathUtils.join(homeDir, ".phantom", "bin", "sing-box"),
                PathUtils.join(homeDir, ".local", "bin", "sing-box"),
                PathUtils.join(homeDir, "bin", "sing-box"),
            );
        }

        for (const path of candidates) {
            try {
                if (await IOUtils.exists(path)) {
                    console.log(`[VPN] Found sing-box: ${path}`);
                    return path;
                }
            } catch {}
        }

        // Try $PATH via `which` (not available in Flatpak, but works natively)
        for (const whichPath of ["/usr/bin/which", "/bin/which"]) {
            try {
                if (!(await IOUtils.exists(whichPath))) continue;
                const proc = await getSubprocess().call({
                    command: whichPath,
                    arguments: ["sing-box"],
                    stderr: "pipe",
                });
                const stdout = await proc.stdout.readString();
                await proc.wait();
                const path = stdout.trim();
                if (path && !path.includes("not found")) {
                    return path;
                }
            } catch {}
        }

        return null;
    }

    // ── Manual server add ──────────────────────────────────────

    addServer(vlessUri) {
        const parsed = parseVlessUri(vlessUri);
        if (!parsed) return null;
        // Replace if same ID exists
        this.#servers = this.#servers.filter(s => s.id !== parsed.id);
        this.#servers.push(parsed);
        this.#saveCacheAsync();
        return parsed;
    }

    removeServer(serverId) {
        this.#servers = this.#servers.filter(s => s.id !== serverId);
        if (this.#activeServerId === serverId) this.#activeServerId = null;
        this.#saveCacheAsync();
    }

    // ── Cache ──────────────────────────────────────────────────

    async #loadCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            const data = await IOUtils.readJSON(path);
            if (Array.isArray(data.servers)) this.#servers = data.servers;
            this.#activeServerId = data.activeServerId || null;
            this.#subscriptionUrl = data.subscriptionUrl || "";
            this.#subscriptionHwid = data.hwid || "";
            if (data.stats) Object.assign(this.#stats, data.stats);
        } catch {}
    }

    async #saveCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            await IOUtils.writeJSON(path, {
                servers: this.#servers,
                activeServerId: this.#activeServerId,
                subscriptionUrl: this.#subscriptionUrl,
                hwid: this.#subscriptionHwid,
                stats: this.#stats,
                updated: Date.now(),
            });
        } catch (e) {
            console.warn("[VPN] Cache save failed:", e.message);
        }
    }

    #saveCacheAsync() { this.#saveCache().catch(() => {}); }

    // ── Cleanup ────────────────────────────────────────────────

    async shutdown() {
        await this.disconnect();
        this.#stopHealthCheck();
        if (this.#subTimer) { this.#subTimer.cancel(); this.#subTimer = null; }
        await this.#saveCache();
    }
}

export const phantomVPN = new VPNEngine();
