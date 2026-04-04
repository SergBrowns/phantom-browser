/**
 * Phantom DPI Bypass Engine v2
 * Ядро системы обхода Deep Packet Inspection и интернет-цензуры
 *
 * v2 изменения:
 *   - TLS_RECORD_SPLIT: разбиение ClientHello на два валидных TLS-record
 *   - COMBO: TLS record split + TCP фрагментация
 *   - QUIC management: отключение QUIC для bypass-доменов (форсирует TCP)
 *   - Strategy rotation: автоподбор стратегии при отказах
 *   - Bypass-all mode: весь трафик через DPI proxy
 *   - Расширенные ISP-паттерны
 *   - RKN sync: автоматическое обновление списка из реестра РКН
 */

import { rknSync } from "resource://phantom/rkn/rkn-sync.sys.mjs";

// Window-free fetch using XPCOM XMLHttpRequest (works in sys.mjs context)
function xhrFetch(url, { method = "GET", headers = {}, body = null, timeout = 15000, responseType = "text" } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        xhr.open(method, url, true);
        xhr.timeout = timeout;
        xhr.responseType = responseType;
        for (const [k, v] of Object.entries(headers)) {
            xhr.setRequestHeader(k, v);
        }
        xhr.addEventListener("load", () => {
            resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                text: () => Promise.resolve(xhr.responseText),
                headers: { get: (name) => xhr.getResponseHeader(name) },
            });
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.addEventListener("timeout", () => reject(new Error("Timeout")));
        xhr.send(body);
    });
}

// ── Стратегии фрагментации ──────────────────────────────────────────────────

export const STRATEGY = Object.freeze({
    SPLIT_SNI:        "split_sni",        // Разрезать TCP-поток на границе SNI
    SPLIT_RECORD:     "split_record",     // Разрезать TCP-поток после TLS record header
    MICRO_FRAG:       "micro_frag",       // Микро-фрагменты по 2-4 байта
    TLS_RECORD_SPLIT: "tls_record_split", // Разбить ClientHello на 2 валидных TLS-record
    COMBO:            "combo",            // TLS record split + TCP fragmentation
    HOST_MIX:         "host_mix",         // HTTP: смешанный регистр Host + trailing dot
});

const FALLBACK_ORDER = [
    STRATEGY.SPLIT_SNI,
    STRATEGY.TLS_RECORD_SPLIT,
    STRATEGY.COMBO,
    STRATEGY.SPLIT_RECORD,
    STRATEGY.MICRO_FRAG,
];

// ── DoH провайдеры ──────────────────────────────────────────────────────────

export const DOH_PROVIDERS = [
    { id: "adguard",    name: "AdGuard DNS",  url: "https://dns.adguard-dns.com/dns-query",   bootstrap: "94.140.14.14",  host: "dns.adguard-dns.com"  },
    { id: "cloudflare", name: "Cloudflare",   url: "https://cloudflare-dns.com/dns-query",    bootstrap: "1.1.1.1",       host: "cloudflare-dns.com"   },
    { id: "google",     name: "Google",       url: "https://dns.google/dns-query",            bootstrap: "8.8.8.8",       host: "dns.google"           },
    { id: "quad9",      name: "Quad9",        url: "https://dns.quad9.net/dns-query",         bootstrap: "9.9.9.9",       host: "dns.quad9.net"        },
    { id: "comss",      name: "Comss.one",    url: "https://dns.comss.one/dns-query",         bootstrap: "92.38.152.163", host: "dns.comss.one"        },
    { id: "nextdns",    name: "NextDNS",      url: "https://dns.nextdns.io/dns-query",        bootstrap: "45.90.28.0",    host: "dns.nextdns.io"       },
];

// ── Встроенный список заблокированных доменов (РФ, 2024-2025) ────────────────

const BUILTIN_BLOCKED = [
    // YouTube ecosystem
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
    "yt3.ggpht.com", "yt3.googleusercontent.com", "youtube-nocookie.com",
    "youtubei.googleapis.com", "wide-youtube.l.google.com",
    "youtube-ui.l.google.com", "yt-video-upload.l.google.com",
    // Twitter / X
    "twitter.com", "x.com", "twimg.com", "t.co", "abs.twimg.com",
    "api.twitter.com", "mobile.twitter.com", "pbs.twimg.com",
    // Meta
    "instagram.com", "cdninstagram.com", "scontent.cdninstagram.com",
    "facebook.com", "fbcdn.net", "fb.com", "fbsbx.com",
    "threads.net", "whatsapp.com", "whatsapp.net",
    // LinkedIn
    "linkedin.com", "licdn.com", "static.licdn.com",
    // Discord
    "discord.com", "discord.gg", "discordapp.com", "discordapp.net",
    "cdn.discordapp.com", "media.discordapp.net", "gateway.discord.gg",
    "images-ext-1.discordapp.net", "dl.discordapp.net",
    // News
    "bbc.com", "bbc.co.uk", "bbci.co.uk", "bbc.in",
    "dw.com", "deutsche-welle.de",
    "svoboda.org", "rferl.org",
    "meduza.io",
    "theins.ru", "theinsider.org",
    "currenttime.tv",
    "imedia.ru",
    "novayagazeta.eu",
    "verstka.media",
    // Archives
    "archive.org", "web.archive.org",
    // VPN & privacy
    "proton.me", "protonvpn.com", "protonmail.com",
    "nordvpn.com", "expressvpn.com", "surfshark.com",
    "windscribe.com", "mullvad.net", "privateinternetaccess.com",
    // Privacy tools
    "duckduckgo.com",
    // AI
    "openai.com", "chatgpt.com", "chat.openai.com",
    "claude.ai", "anthropic.com",
    // Dev & content
    "medium.com",
    "soundcloud.com",
    "dailymotion.com", "vimeo.com",
    "patreon.com",
    "change.org",
    "4chan.org", "4channel.org",
    "rutracker.org", "nnmclub.to",
    // Gaming
    "store.steampowered.com",
    // Social
    "tinder.com",
    "tumblr.com",
    "spotify.com",
    "twitch.tv",
    // QUIC-specific CDN hosts (for QUIC disable)
    "quic.rocks", "cloudflare-quic.com",
    // DoH provider domains — MUST be DPI-bypassed to prevent dead-loop:
    // browser needs DoH for DNS → DoH connection needs DPI bypass → DPI bypass needs DNS
    "dns.adguard-dns.com", "cloudflare-dns.com", "dns.google",
    "dns.quad9.net", "dns.comss.one", "dns.nextdns.io",
    "mozilla.cloudflare-dns.com", "dns10.quad9.net",
];

// ── Паттерны ISP block-page ─────────────────────────────────────────────────

const BLOCK_PAGE_PATTERNS = [
    // Roskomnadzor
    /eais\.rkn\.gov\.ru/i,
    /nap\.rkn\.gov\.ru/i,
    /blocklist\.rkn/i,
    /rkn\.gov\.ru/i,
    /vigruzki\.rkn\.gov\.ru/i,
    /398-fz/i,
    /149-fz/i,

    // ISP block pages
    /warning\.rt\.ru/i,
    /block\.rt\.ru/i,
    /blocked?\.(?:mts|beeline|megafon|tele2|rostelecom|rt)\./i,
    /filter\.(?:mts|beeline|megafon|tele2)\./i,
    /restrict\.(?:mts|beeline|megafon)\./i,
    /access\.blocked\.(?:mts|beeline)\./i,
    /blackhole\./i,
    /zapret-info/i,
    /internet\.rt\.ru.*zapret/i,

    // Regional ISPs
    /blocked?\.(?:ttk|er-telecom|domru|akado|netbynet|onlime)/i,
    /block\.dom\.ru/i,
    /blocked\.ttk\.ru/i,

    // Generic text patterns (response body / title)
    /доступ.*ограничен/i,
    /заблокирован.*роскомнадзор/i,
    /заблокирован.*решени/i,
    /заблокирован.*основании/i,
    /ресурс.*заблокирован/i,
    /сайт.*заблокирован/i,
    /решению.*суда/i,
    /федеральн.*закон.*149/i,
    /федеральн.*закон.*398/i,
    /единый.*реестр/i,
    /Генеральн.*прокуратур/i,
    /access.*denied.*federal.*law/i,
    /blocked.*accordance.*law/i,
    /restricted.*roskomnadzor/i,
    /blocked.*russian.*law/i,
];

// ── Block page title patterns (for content-sniffing) ────────────────────────

export const BLOCK_TITLE_PATTERNS = [
    /заблокирован/i,
    /доступ.*ограничен/i,
    /ресурс.*заблокирован/i,
    /blocked.*rkn/i,
    /сайт.*недоступен.*решени/i,
    /access.*restricted/i,
];

// ── Remote list URLs ────────────────────────────────────────────────────────

const DEFAULT_LIST_URLS = [
    "https://antifilter.download/list/domains.lst",
    "https://community.antifilter.download/list/domains.lst",
];

const CACHE_FILE = "phantom-dpi.json";
const LIST_UPDATE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// ── Engine ──────────────────────────────────────────────────────────────────

export class DPIEngine {
    #blockedDomains = new Set();
    #builtinDomains = new Set();
    #remoteDomains = new Set();
    #rknDomains = new Set();          // домены из реестра РКН
    #userDomains = new Set();
    #userExceptions = new Set();
    #autoDetected = new Set();
    #domainStrategies = new Map();
    #domainFailures = new Map();      // domain → { strategy, failures }
    #defaultStrategy = STRATEGY.SPLIT_SNI;
    #fragmentDelay = 50;
    #microFragSize = 3;
    #enabled = false;
    #initialized = false;
    #bypassAll = false;               // route ALL traffic through DPI proxy
    #disableQuicForBlocked = true;    // force TCP for blocked domains
    #dohProviderIndex = 0;
    #ipBlockedDomains = new Set();  // domains blocked by IP, not just SNI — need real proxy
    #stats = { bypassed: 0, direct: 0, failed: 0, autoDetected: 0, totalDomains: 0, strategyRotations: 0 };
    #updateTimer = null;
    #trrVerified = false;  // true after DoH is confirmed working

    async init() {
        this.#enabled = Services.prefs.getBoolPref("phantom.dpi.enabled", true);
        if (!this.#enabled) {
            console.log("[DPI] Disabled by preference");
            return;
        }

        for (const d of BUILTIN_BLOCKED) {
            this.#builtinDomains.add(d);
            this.#blockedDomains.add(d);
        }

        await this.#loadCache();

        // Инициализируем RKN Sync и загружаем текущие данные
        await rknSync.init();
        this.#loadRknDomains();
        rknSync.onUpdate(() => {
            this.#loadRknDomains();
            this.#rebuildMasterList();
            console.log(`[DPI] RKN list updated: ${this.#rknDomains.size} domains added`);
        });

        this.#rebuildMasterList();
        this.#applyDohSettings();
        this.#applyEchSettings();

        // Load user prefs
        this.#defaultStrategy = Services.prefs.getStringPref("phantom.dpi.strategy", STRATEGY.SPLIT_SNI);
        this.#fragmentDelay = Services.prefs.getIntPref("phantom.dpi.fragment.delay", 50);
        this.#microFragSize = Services.prefs.getIntPref("phantom.dpi.fragment.microsize", 3);
        this.#bypassAll = Services.prefs.getBoolPref("phantom.dpi.bypass.all", false);
        this.#disableQuicForBlocked = Services.prefs.getBoolPref("phantom.dpi.quic.disable", false);

        // Apply QUIC settings
        this.#applyQuicSettings();

        this.#initialized = true;
        console.log(`[DPI] Engine v2 initialized: ${this.#blockedDomains.size} domains (${this.#rknDomains.size} RKN), strategy=${this.#defaultStrategy}, bypassAll=${this.#bypassAll}`);

        this.#scheduleListUpdate();
        this.updateRemoteLists().catch(e => console.warn("[DPI] Initial list update failed:", e.message));
    }

    #loadRknDomains() {
        this.#rknDomains.clear();
        for (const d of rknSync.getDomains()) {
            this.#rknDomains.add(d);
        }
    }

    get enabled() { return this.#enabled; }
    get initialized() { return this.#initialized; }
    get defaultStrategy() { return this.#defaultStrategy; }
    get fragmentDelay() { return this.#fragmentDelay; }
    get microFragSize() { return this.#microFragSize; }
    get domainCount() { return this.#blockedDomains.size; }
    get bypassAll() { return this.#bypassAll; }
    get disableQuicForBlocked() { return this.#disableQuicForBlocked; }

    get stats() {
        return {
            ...this.#stats,
            totalDomains: this.#blockedDomains.size,
            builtinCount: this.#builtinDomains.size,
            remoteCount: this.#remoteDomains.size,
            rknCount: this.#rknDomains.size,
            userCount: this.#userDomains.size,
            exceptionsCount: this.#userExceptions.size,
            autoDetectedCount: this.#autoDetected.size,
            rknLastUpdated: rknSync.lastUpdated,
        };
    }

    // ── Domain checks ───────────────────────────────────────

    isBlocked(hostname) {
        if (!this.#enabled || !this.#initialized) return false;
        if (!hostname) return false;

        // Bypass-all mode: everything is "blocked" → goes through DPI proxy
        if (this.#bypassAll) return true;

        const host = hostname.toLowerCase().replace(/\.$/, "");

        if (this.#userExceptions.has(host)) return false;
        if (this.#blockedDomains.has(host)) return true;

        const parts = host.split(".");
        for (let i = 1; i < parts.length - 1; i++) {
            const parent = parts.slice(i).join(".");
            if (this.#userExceptions.has(parent)) return false;
            if (this.#blockedDomains.has(parent)) return true;
        }

        return false;
    }

    /**
     * Проверяет, нужно ли отключать QUIC для домена
     */
    shouldDisableQuic(hostname) {
        if (!this.#disableQuicForBlocked) return false;
        return this.isBlocked(hostname);
    }

    // ── Strategy management (v2) ────────────────────────────

    getStrategy(hostname) {
        const host = hostname.toLowerCase().replace(/\.$/, "");
        return this.#domainStrategies.get(host) || this.#defaultStrategy;
    }

    getFallbackStrategies(hostname) {
        const primary = this.getStrategy(hostname);
        const fallbacks = FALLBACK_ORDER.filter(s => s !== primary);
        return [primary, ...fallbacks];
    }

    /**
     * Сообщить о провале стратегии для домена.
     * Движок автоматически переключится на следующую в fallback-цепочке.
     */
    reportStrategyFailure(hostname, strategy) {
        const host = hostname.toLowerCase();
        const current = this.#domainFailures.get(host) || { failures: new Set() };
        current.failures.add(strategy);
        this.#domainFailures.set(host, current);

        // Find next strategy that hasn't failed
        const fallbacks = FALLBACK_ORDER.filter(s => !current.failures.has(s));
        if (fallbacks.length > 0) {
            this.#domainStrategies.set(host, fallbacks[0]);
            this.#stats.strategyRotations++;
            console.log(`[DPI] Strategy rotation for ${host}: ${strategy} → ${fallbacks[0]}`);
            return fallbacks[0];
        }

        // All strategies failed — reset and try again from the beginning
        current.failures.clear();
        this.#domainStrategies.delete(host);
        return this.#defaultStrategy;
    }

    /**
     * Сообщить об успехе стратегии — зафиксировать для домена
     */
    reportStrategySuccess(hostname, strategy) {
        const host = hostname.toLowerCase();
        this.#domainStrategies.set(host, strategy);
        this.#domainFailures.delete(host);
    }

    // ── Domain management ───────────────────────────────────

    addUserDomain(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#userDomains.add(d);
        this.#rebuildMasterList();
        this.#saveCacheAsync();
    }

    removeUserDomain(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#userDomains.delete(d);
        this.#rebuildMasterList();
        this.#saveCacheAsync();
    }

    addException(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#userExceptions.add(d);
        this.#saveCacheAsync();
    }

    removeException(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#userExceptions.delete(d);
        this.#saveCacheAsync();
    }

    addAutoDetected(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        if (this.#blockedDomains.has(d)) return;
        this.#autoDetected.add(d);
        this.#blockedDomains.add(d);
        this.#stats.autoDetected++;
        this.#saveCacheAsync();
        console.log(`[DPI] Auto-detected blocked domain: ${d}`);
    }

    setStrategy(domain, strategy) {
        this.#domainStrategies.set(domain.toLowerCase(), strategy);
        this.#saveCacheAsync();
    }

    getUserDomains() { return [...this.#userDomains]; }
    getUserExceptions() { return [...this.#userExceptions]; }
    getAutoDetected() { return [...this.#autoDetected]; }

    // ── IP-blocked domains (DPI bypass not enough, need real proxy) ──

    /**
     * Помечает домен как заблокированный по IP.
     * Для таких доменов DPI-фрагментация бесполезна — нужен внешний прокси.
     */
    markIpBlocked(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#ipBlockedDomains.add(d);
        this.#saveCacheAsync();
        console.log(`[DPI] Marked as IP-blocked: ${d} (needs external proxy)`);
    }

    unmarkIpBlocked(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        this.#ipBlockedDomains.delete(d);
        this.#saveCacheAsync();
    }

    isIpBlocked(hostname) {
        if (!hostname) return false;
        const host = hostname.toLowerCase().replace(/\.$/, "");
        if (this.#ipBlockedDomains.has(host)) return true;
        const parts = host.split(".");
        for (let i = 1; i < parts.length - 1; i++) {
            if (this.#ipBlockedDomains.has(parts.slice(i).join("."))) return true;
        }
        return false;
    }

    getIpBlockedDomains() { return [...this.#ipBlockedDomains]; }

    // ── TRR exclusions (domains that MUST use system/ISP DNS) ──

    getTrrExclusions() {
        const raw = Services.prefs.getStringPref("network.trr.excluded-domains", "");
        return raw.split(",").map(s => s.trim()).filter(s => s && s !== "localhost" && s !== "local");
    }

    addTrrExclusion(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        const current = Services.prefs.getStringPref("network.trr.excluded-domains", "localhost,local");
        const parts = current.split(",").map(s => s.trim());
        if (!parts.includes(d)) {
            parts.push(d);
            Services.prefs.setStringPref("network.trr.excluded-domains", parts.join(","));
            console.log(`[DPI] TRR exclusion added: ${d} (uses system DNS)`);
        }
    }

    removeTrrExclusion(domain) {
        const d = domain.toLowerCase().replace(/\.$/, "");
        const current = Services.prefs.getStringPref("network.trr.excluded-domains", "localhost,local");
        const parts = current.split(",").map(s => s.trim()).filter(s => s !== d);
        Services.prefs.setStringPref("network.trr.excluded-domains", parts.join(","));
        console.log(`[DPI] TRR exclusion removed: ${d}`);
    }

    // ── Strategy configuration ──────────────────────────────

    setDefaultStrategy(strategy) {
        this.#defaultStrategy = strategy;
        Services.prefs.setStringPref("phantom.dpi.strategy", strategy);
    }

    setFragmentDelay(ms) {
        this.#fragmentDelay = Math.max(10, Math.min(500, ms));
        Services.prefs.setIntPref("phantom.dpi.fragment.delay", this.#fragmentDelay);
    }

    setMicroFragSize(bytes) {
        this.#microFragSize = Math.max(1, Math.min(8, bytes));
        Services.prefs.setIntPref("phantom.dpi.fragment.microsize", this.#microFragSize);
    }

    // ── Bypass-all mode ─────────────────────────────────────

    setBypassAll(val) {
        this.#bypassAll = !!val;
        Services.prefs.setBoolPref("phantom.dpi.bypass.all", this.#bypassAll);
    }

    // ── QUIC management (v2) ────────────────────────────────

    setDisableQuic(val) {
        this.#disableQuicForBlocked = !!val;
        Services.prefs.setBoolPref("phantom.dpi.quic.disable", this.#disableQuicForBlocked);
        this.#applyQuicSettings();
    }

    /**
     * Управляет QUIC (HTTP/3).
     *
     * По умолчанию QUIC включён — браузер использует HTTP/3 для незаблокированных сайтов.
     * DPI proxy работает через TCP-прокси (HTTP CONNECT); когда Firefox видит, что для
     * домена назначен прокси, он автоматически переходит на TCP (HTTP/2), поэтому DPI bypass
     * не требует глобального отключения QUIC.
     *
     * Отключить QUIC имеет смысл только если ISP блокирует UDP целиком или
     * DPI bypass перестаёт работать из-за alt-svc кэша на конкретном устройстве.
     * Включается вручную через "Отключить QUIC" в панели DPI.
     */
    #applyQuicSettings() {
        if (this.#disableQuicForBlocked) {
            Services.prefs.setBoolPref("network.http.http3.enabled", false);
            console.log("[DPI] QUIC (HTTP/3) disabled — forcing TCP for DPI bypass");
        } else {
            Services.prefs.setBoolPref("network.http.http3.enabled", true);
            console.log("[DPI] QUIC (HTTP/3) enabled");
        }
    }

    // ── DoH management ──────────────────────────────────────

    getDohProviders() { return DOH_PROVIDERS; }

    getCurrentDoh() {
        return DOH_PROVIDERS[this.#dohProviderIndex] || DOH_PROVIDERS[0];
    }

    setDohProvider(providerId) {
        const idx = DOH_PROVIDERS.findIndex(p => p.id === providerId);
        if (idx === -1) return false;
        this.#dohProviderIndex = idx;
        this.#applyDohSettings();
        Services.prefs.setStringPref("phantom.dpi.doh.provider", providerId);
        console.log(`[DPI] DoH switched to ${DOH_PROVIDERS[idx].name}`);
        return true;
    }

    setCustomDoh(url, bootstrap) {
        Services.prefs.setIntPref("network.trr.mode", 3);
        Services.prefs.setStringPref("network.trr.uri", url);
        if (bootstrap) Services.prefs.setStringPref("network.trr.bootstrapAddress", bootstrap);
        Services.prefs.setStringPref("phantom.dpi.doh.provider", "custom");
        Services.prefs.setStringPref("phantom.dpi.doh.custom.url", url);
        Services.prefs.setStringPref("phantom.dpi.doh.custom.bootstrap", bootstrap || "");
        console.log(`[DPI] DoH set to custom: ${url}`);
    }

    switchToNextDoh() {
        this.#dohProviderIndex = (this.#dohProviderIndex + 1) % DOH_PROVIDERS.length;
        this.#applyDohSettings();
        const provider = DOH_PROVIDERS[this.#dohProviderIndex];
        console.log(`[DPI] DoH failover to ${provider.name}`);
        return provider;
    }

    #applyDohSettings() {
        const savedProvider = Services.prefs.getStringPref("phantom.dpi.doh.provider", "adguard");
        if (savedProvider === "custom") {
            const url = Services.prefs.getStringPref("phantom.dpi.doh.custom.url", "");
            if (url) {
                // Don't force mode 3 — will be upgraded after verification
                Services.prefs.setStringPref("network.trr.uri", url);
                const bs = Services.prefs.getStringPref("phantom.dpi.doh.custom.bootstrap", "");
                if (bs) Services.prefs.setStringPref("network.trr.bootstrapAddress", bs);
                return;
            }
        }
        const idx = DOH_PROVIDERS.findIndex(p => p.id === savedProvider);
        if (idx !== -1) this.#dohProviderIndex = idx;
        const provider = DOH_PROVIDERS[this.#dohProviderIndex];
        // Start with mode 2 (DoH first, fallback to system DNS)
        // verifyAndUpgradeTrr() will switch to mode 3 after confirming DoH works
        if (!this.#trrVerified) {
            Services.prefs.setIntPref("network.trr.mode", 2);
        }
        Services.prefs.setStringPref("network.trr.uri", provider.url);
        Services.prefs.setStringPref("network.trr.bootstrapAddress", provider.bootstrap);
    }

    #applyEchSettings() {
        Services.prefs.setBoolPref("network.dns.echconfig.enabled", true);
        Services.prefs.setBoolPref("network.dns.http3_echconfig.enabled", true);
    }

    /**
     * Проверяет доступность DoH и переключает TRR mode.
     * Вызывается ПОСЛЕ запуска DPI-прокси, чтобы DoH-соединение
     * само шло через DPI bypass (домены провайдеров в bypass-списке).
     *
     * Логика:
     *   1. Пробуем текущего провайдера
     *   2. Если не работает — перебираем остальных
     *   3. Если хотя бы один работает → фиксируем провайдера, остаёмся на mode 2
     *      (mode 3 убивает DNS при любом сбое DoH — особенно в Flatpak-песочнице)
     *   4. Если все мертвы → TRR mode 0 (system DNS only)
     */
    async verifyAndUpgradeTrr() {
        const currentProvider = this.getCurrentDoh();
        const allProviders = [
            currentProvider,
            ...DOH_PROVIDERS.filter(p => p.id !== currentProvider.id),
        ];

        for (const provider of allProviders) {
            try {
                const ok = await this.#testDohProvider(provider);
                if (ok) {
                    // This provider works — lock to it, keep mode 2 (DoH first, system fallback)
                    // Mode 3 is dangerous: if DoH connection drops (Flatpak sandbox,
                    // network change, ISP blocking), ALL DNS dies with no recovery path.
                    // Mode 2 gives us DoH benefits with graceful degradation.
                    if (provider.id !== currentProvider.id) {
                        this.setDohProvider(provider.id);
                    }
                    Services.prefs.setIntPref("network.trr.mode", 2);
                    this.#trrVerified = true;
                    console.log(`[DPI] DoH verified: ${provider.name} — TRR mode 2 (DoH first, system fallback)`);
                    return { ok: true, provider, mode: 2 };
                }
            } catch {
                // Provider unreachable — try next
            }
        }

        // All providers failed — disable DoH, use system DNS only
        Services.prefs.setIntPref("network.trr.mode", 0);
        this.#trrVerified = false;
        console.warn("[DPI] All DoH providers unreachable — TRR mode → 0 (system DNS only)");
        return { ok: false, mode: 0 };
    }

    /**
     * Тест конкретного DoH провайдера.
     * Делаем DNS-over-HTTPS запрос для example.com и проверяем ответ.
     */
    async #testDohProvider(provider) {
        const wireQuery = this.#buildDnsQuery("example.com");
        const response = await xhrFetch(provider.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/dns-message",
                "Accept": "application/dns-message",
            },
            body: wireQuery,
            timeout: 8000,
            responseType: "arraybuffer",
        });
        return response.ok;
    }

    /**
     * Формирует минимальный DNS wire-format запрос (RFC 1035) для A-записи.
     */
    #buildDnsQuery(hostname) {
        const labels = hostname.split(".");
        // Header: ID(2) + Flags(2) + QDCOUNT(2) + ANCOUNT(2) + NSCOUNT(2) + ARCOUNT(2) = 12 bytes
        // Question: labels + null(1) + QTYPE(2) + QCLASS(2)
        let qnameLen = 1; // trailing null
        for (const label of labels) qnameLen += 1 + label.length;
        const buf = new Uint8Array(12 + qnameLen + 4);
        // ID = 0x0000, Flags: RD=1 (0x0100), QDCOUNT=1
        buf[2] = 0x01; buf[5] = 0x01;
        let offset = 12;
        for (const label of labels) {
            buf[offset++] = label.length;
            for (let i = 0; i < label.length; i++) buf[offset++] = label.charCodeAt(i);
        }
        buf[offset++] = 0; // null terminator
        buf[offset++] = 0; buf[offset++] = 1; // QTYPE = A
        buf[offset++] = 0; buf[offset++] = 1; // QCLASS = IN
        return buf;
    }

    get trrVerified() { return this.#trrVerified; }
    get currentTrrMode() { return Services.prefs.getIntPref("network.trr.mode", 2); }

    // ── Block page detection ────────────────────────────────

    isBlockPage(url, location, body) {
        const inputs = [url, location, body].filter(Boolean);
        for (const input of inputs) {
            for (const pat of BLOCK_PAGE_PATTERNS) {
                if (pat.test(input)) return true;
            }
        }
        return false;
    }

    isBlockPageTitle(title) {
        if (!title) return false;
        for (const pat of BLOCK_TITLE_PATTERNS) {
            if (pat.test(title)) return true;
        }
        return false;
    }

    // ── Remote list updates ─────────────────────────────────

    async updateRemoteLists() {
        const listUrls = Services.prefs.getStringPref(
            "phantom.dpi.list.urls",
            DEFAULT_LIST_URLS.join(",")
        ).split(",").map(s => s.trim()).filter(Boolean);

        let totalNew = 0;

        for (const listUrl of listUrls) {
            try {
                const response = await xhrFetch(listUrl, {
                    timeout: 30000,
                    headers: { "User-Agent": "Mozilla/5.0" },
                });
                if (!response.ok) { console.warn(`[DPI] List HTTP ${response.status}: ${listUrl}`); continue; }

                const text = await response.text();
                const domains = this.#parseDomainList(text);
                let added = 0;
                for (const d of domains) {
                    if (!this.#remoteDomains.has(d)) { this.#remoteDomains.add(d); added++; }
                }
                totalNew += added;
                console.log(`[DPI] Loaded ${domains.length} domains from ${new URL(listUrl).hostname} (+${added} new)`);
            } catch (e) {
                // List fetch may fail on startup — will retry on next update cycle
            }
        }

        if (totalNew > 0) {
            this.#rebuildMasterList();
            await this.#saveCache();
        }
        return totalNew;
    }

    #parseDomainList(text) {
        const domains = [];
        for (const rawLine of text.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#") || line.startsWith("!") || line.startsWith("[")) continue;

            let domain = line;
            const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(.+)/);
            if (hostsMatch) domain = hostsMatch[1].trim();
            const adblockMatch = line.match(/^\|\|([^^\s/$]+)/);
            if (adblockMatch) domain = adblockMatch[1];

            domain = domain.toLowerCase().replace(/\.$/, "");
            if (domain && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain) && domain.length < 256) {
                domains.push(domain);
            }
        }
        return domains;
    }

    #rebuildMasterList() {
        this.#blockedDomains.clear();
        for (const d of this.#builtinDomains) this.#blockedDomains.add(d);
        for (const d of this.#remoteDomains) this.#blockedDomains.add(d);
        for (const d of this.#rknDomains) this.#blockedDomains.add(d);
        for (const d of this.#userDomains) this.#blockedDomains.add(d);
        for (const d of this.#autoDetected) this.#blockedDomains.add(d);
        this.#stats.totalDomains = this.#blockedDomains.size;
    }

    #scheduleListUpdate() {
        if (this.#updateTimer) return;
        this.#updateTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        this.#updateTimer.initWithCallback(
            () => this.updateRemoteLists().catch(() => {}),
            LIST_UPDATE_INTERVAL,
            Ci.nsITimer.TYPE_REPEATING_SLACK
        );
    }

    // ── Stats ───────────────────────────────────────────────

    recordBypassed() { this.#stats.bypassed++; }
    recordDirect()   { this.#stats.direct++; }
    recordFailed()   { this.#stats.failed++; }
    resetStats() { Object.assign(this.#stats, { bypassed: 0, direct: 0, failed: 0, autoDetected: 0, strategyRotations: 0 }); }

    // ── Enable / disable ────────────────────────────────────

    setEnabled(val) {
        this.#enabled = !!val;
        Services.prefs.setBoolPref("phantom.dpi.enabled", this.#enabled);
    }

    // ── Cache ───────────────────────────────────────────────

    async #loadCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            const data = await IOUtils.readJSON(path);

            if (Array.isArray(data.remoteDomains)) for (const d of data.remoteDomains) this.#remoteDomains.add(d);
            if (Array.isArray(data.userDomains)) for (const d of data.userDomains) this.#userDomains.add(d);
            if (Array.isArray(data.userExceptions)) for (const d of data.userExceptions) this.#userExceptions.add(d);
            if (Array.isArray(data.autoDetected)) for (const d of data.autoDetected) this.#autoDetected.add(d);
            if (Array.isArray(data.ipBlocked)) for (const d of data.ipBlocked) this.#ipBlockedDomains.add(d);
            if (data.domainStrategies && typeof data.domainStrategies === "object") {
                for (const [k, v] of Object.entries(data.domainStrategies)) this.#domainStrategies.set(k, v);
            }
            if (data.stats) Object.assign(this.#stats, data.stats);

            console.log(`[DPI] Cache loaded: ${this.#remoteDomains.size} remote, ${this.#userDomains.size} user, ${this.#autoDetected.size} auto-detected`);
        } catch {
            // No cache
        }
    }

    async #saveCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            await IOUtils.writeJSON(path, {
                remoteDomains: [...this.#remoteDomains].slice(0, 100000),
                userDomains: [...this.#userDomains],
                userExceptions: [...this.#userExceptions],
                autoDetected: [...this.#autoDetected].slice(0, 5000),
                ipBlocked: [...this.#ipBlockedDomains],
                domainStrategies: Object.fromEntries(this.#domainStrategies),
                stats: this.#stats,
                updated: Date.now(),
            });
        } catch (e) {
            console.warn("[DPI] Failed to save cache:", e.message);
        }
    }

    #saveCacheAsync() { this.#saveCache().catch(() => {}); }

    // ── Cleanup ─────────────────────────────────────────────

    shutdown() {
        if (this.#updateTimer) { this.#updateTimer.cancel(); this.#updateTimer = null; }
        this.#saveCache().catch(() => {});
    }
}

export const phantomDPI = new DPIEngine();
