/**
 * Phantom RKN Sync
 * Загружает официальный реестр РКН из зеркала zapret-info
 * (ежедневный дамп ФГИС ЕАИС, публикуется на github.com/zapret-info/z-i).
 *
 * Предоставляет списки заблокированных доменов и IP-адресов
 * для DPI Bypass Engine и VPN Engine.
 */

function xhrFetch(url, { timeout = 90000 } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.mozBackgroundRequest = true;
        xhr.open("GET", url, true);
        xhr.timeout = timeout;
        xhr.responseType = "text";
        xhr.setRequestHeader("User-Agent", "Mozilla/5.0");
        xhr.addEventListener("load", () => {
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: () => xhr.responseText });
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.addEventListener("timeout", () => reject(new Error("Timeout")));
        xhr.send();
    });
}

// ── Источники данных ──────────────────────────────────────────────────────

const SOURCES = [
    {
        id:     "zapret-csv",
        url:    "https://raw.githubusercontent.com/zapret-info/z-i/master/dump.csv",
        format: "rkn-csv",
        label:  "РКН ФГИС ЕАИС (zapret-info)",
    },
    {
        id:     "antifilter-domains",
        url:    "https://antifilter.download/list/domains.lst",
        format: "domain-list",
        label:  "antifilter.download domains",
    },
    {
        id:     "antifilter-ip",
        url:    "https://antifilter.download/list/ip.lst",
        format: "ip-list",
        label:  "antifilter.download IPs",
    },
];

const CACHE_FILE        = "phantom-rkn.json";
const UPDATE_INTERVAL   = 60 * 60 * 1000; // 1 час

// ── RKNSync ───────────────────────────────────────────────────────────────

export class RKNSync {
    #domains      = new Set();
    #ips          = new Set();
    #lastUpdated  = 0;
    #initialized  = false;
    #syncing      = false;
    #updateTimer  = null;
    #listeners    = new Set();

    async init() {
        if (this.#initialized) return;
        await this.#loadCache();
        this.#initialized = true;
        this.#scheduleUpdates();
        // Синхронизируем если кэш устарел
        if (Date.now() - this.#lastUpdated > UPDATE_INTERVAL) {
            this.sync().catch(e => console.warn("[RKN] Initial sync failed:", e.message));
        }
        console.log(`[RKN] Initialized: ${this.#domains.size} domains, ${this.#ips.size} IPs, lastUpdated=${this.#lastUpdated ? new Date(this.#lastUpdated).toISOString() : "never"}`);
    }

    // ── Getters ───────────────────────────────────────────────────────────

    get initialized()  { return this.#initialized; }
    get lastUpdated()  { return this.#lastUpdated; }
    get syncing()      { return this.#syncing; }
    get domainCount()  { return this.#domains.size; }
    get ipCount()      { return this.#ips.size; }

    getDomains() { return this.#domains; }
    getIPs()     { return this.#ips; }

    // ── Подписка на обновления ─────────────────────────────────────────────

    onUpdate(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    #emit() {
        for (const fn of this.#listeners) {
            try { fn(); } catch (e) { console.error("[RKN]", e); }
        }
    }

    // ── Синхронизация ─────────────────────────────────────────────────────

    async sync() {
        if (this.#syncing) return { ok: false, error: "Already syncing" };
        this.#syncing = true;

        const newDomains = new Set();
        const newIPs     = new Set();
        const results    = [];

        for (const source of SOURCES) {
            try {
                console.log(`[RKN] Fetching ${source.label}...`);
                const res = await xhrFetch(source.url);
                if (!res.ok) {
                    results.push({ id: source.id, ok: false, error: `HTTP ${res.status}` });
                    console.warn(`[RKN] ${source.label}: HTTP ${res.status}`);
                    continue;
                }
                const text = res.text();
                switch (source.format) {
                    case "rkn-csv":     this.#parseRknCsv(text, newDomains, newIPs); break;
                    case "domain-list": this.#parseDomainList(text, newDomains);     break;
                    case "ip-list":     this.#parseIPList(text, newIPs);             break;
                }
                results.push({ id: source.id, ok: true });
                console.log(`[RKN] ${source.label}: OK (${newDomains.size} domains, ${newIPs.size} IPs so far)`);
            } catch (e) {
                results.push({ id: source.id, ok: false, error: e.message });
                console.warn(`[RKN] ${source.label} failed: ${e.message}`);
            }
        }

        const anyOk = results.some(r => r.ok);
        if (anyOk && (newDomains.size > 0 || newIPs.size > 0)) {
            this.#domains     = newDomains;
            this.#ips         = newIPs;
            this.#lastUpdated = Date.now();
            await this.#saveCache();
            this.#emit();
            console.log(`[RKN] Sync complete: ${this.#domains.size} domains, ${this.#ips.size} IPs`);
        }

        this.#syncing = false;
        return { ok: anyOk, domains: this.#domains.size, ips: this.#ips.size, results };
    }

    // ── Парсеры ───────────────────────────────────────────────────────────

    /**
     * Формат zapret-info dump.csv (кодировка windows-1251, разделитель ';'):
     *   IP | Domain | IP_subnet | Дата | Номер решения | Организация
     * Поля могут содержать несколько значений через |
     */
    #parseRknCsv(text, domains, ips) {
        for (const rawLine of text.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("//") || line.startsWith("#")) continue;

            const parts = line.split(";");
            if (parts.length < 2) continue;

            // Колонка 0: IP-адреса
            const ipField = (parts[0] || "").trim();
            if (ipField) {
                for (const raw of ipField.split("|")) {
                    const ip = raw.trim();
                    if (ip && /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip)) {
                        ips.add(ip);
                    }
                }
            }

            // Колонка 1: домены
            const domainField = (parts[1] || "").trim();
            if (domainField) {
                for (const raw of domainField.split("|")) {
                    const domain = this.#normalizeDomain(raw);
                    if (domain) domains.add(domain);
                }
            }
        }
    }

    #parseDomainList(text, domains) {
        for (const rawLine of text.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#") || line.startsWith("!") || line.startsWith("[")) continue;
            const domain = this.#normalizeDomain(line);
            if (domain) domains.add(domain);
        }
    }

    #parseIPList(text, ips) {
        for (const rawLine of text.split("\n")) {
            const ip = rawLine.trim();
            if (!ip || ip.startsWith("#")) continue;
            if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip)) {
                ips.add(ip);
            }
        }
    }

    #normalizeDomain(raw) {
        const d = raw.trim()
            .toLowerCase()
            .replace(/\.$/, "")
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "");
        if (d && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) && d.length < 256) {
            return d;
        }
        return null;
    }

    // ── Расписание ────────────────────────────────────────────────────────

    #scheduleUpdates() {
        this.#updateTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        this.#updateTimer.initWithCallback(
            () => this.sync().catch(() => {}),
            UPDATE_INTERVAL,
            Ci.nsITimer.TYPE_REPEATING_SLACK
        );
    }

    // ── Кэш ──────────────────────────────────────────────────────────────

    async #loadCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            const data = await IOUtils.readJSON(path);
            if (Array.isArray(data.domains)) for (const d of data.domains) this.#domains.add(d);
            if (Array.isArray(data.ips))     for (const ip of data.ips)    this.#ips.add(ip);
            this.#lastUpdated = data.lastUpdated || 0;
        } catch { /* первый запуск */ }
    }

    async #saveCache() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, CACHE_FILE);
            await IOUtils.writeJSON(path, {
                domains:     [...this.#domains],
                ips:         [...this.#ips],
                lastUpdated: this.#lastUpdated,
            });
        } catch (e) {
            console.warn("[RKN] Cache save failed:", e.message);
        }
    }

    async shutdown() {
        if (this.#updateTimer) {
            this.#updateTimer.cancel();
            this.#updateTimer = null;
        }
    }
}

export const rknSync = new RKNSync();
