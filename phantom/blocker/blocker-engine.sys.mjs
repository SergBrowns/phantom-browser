/**
 * Phantom Ad Blocker Engine
 * Блокировка рекламы и трекеров на уровне движка
 * Поддерживает EasyList и EasyPrivacy
 */

const LIST_URLS = {
    easylist: "https://easylist.to/easylist/easylist.txt",
    easyprivacy: "https://easylist.to/easylist/easyprivacy.txt",
};

const DB_FILE = "phantom-blocker.json";
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export class BlockerEngine {
    #rules = new Set();
    #domainRules = new Map();  // domain -> Set of rules
    #whitelistRules = new Set();
    #cosmeticRules = new Map(); // domain -> CSS selectors
    #initialized = false;
    #stats = { blocked: 0, total: 0 };

    async init() {
        await this.#loadCached();

        // Если кеша нет или устарел — обновить
        if (this.#rules.size === 0) {
            await this.updateLists();
        }

        this.#initialized = true;

        // Периодическое обновление (setInterval недоступен в sys.mjs — используем lazy timer)
        const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timer.initWithCallback(
            () => this.updateLists(),
            UPDATE_INTERVAL,
            Ci.nsITimer.TYPE_REPEATING_SLACK
        );
    }

    get stats() { return { ...this.#stats }; }
    get ruleCount() { return this.#rules.size; }

    /**
     * Проверяет, должен ли запрос быть заблокирован
     */
    shouldBlock(url, sourceUrl, type) {
        if (!this.#initialized) return false;

        this.#stats.total++;

        const urlLower = url.toLowerCase();

        // Белый список
        for (const rule of this.#whitelistRules) {
            if (this.#matchRule(urlLower, rule)) return false;
        }

        // Проверка по доменным правилам
        try {
            const hostname = new URL(url).hostname;
            const domainRules = this.#domainRules.get(hostname);
            if (domainRules) {
                for (const rule of domainRules) {
                    if (this.#matchRule(urlLower, rule)) {
                        this.#stats.blocked++;
                        return true;
                    }
                }
            }
        } catch {}

        // Общие правила
        for (const rule of this.#rules) {
            if (this.#matchRule(urlLower, rule)) {
                this.#stats.blocked++;
                return true;
            }
        }

        return false;
    }

    /**
     * Возвращает CSS-селекторы для скрытия элементов на странице
     */
    getCosmeticFilters(hostname) {
        const filters = [];

        // Общие cosmetic rules
        const general = this.#cosmeticRules.get("*") || [];
        filters.push(...general);

        // Domain-specific
        const domain = this.#cosmeticRules.get(hostname) || [];
        filters.push(...domain);

        return filters;
    }

    /**
     * Обновить списки фильтров
     */
    async updateLists() {
        const enabledLists = Services.prefs.getStringPref("phantom.blocker.lists", "easylist,easyprivacy");
        const lists = enabledLists.split(",").map(s => s.trim());

        for (const listName of lists) {
            const listUrl = LIST_URLS[listName];
            if (!listUrl) continue;

            try {
                const response = await fetch(listUrl);
                if (!response.ok) continue;

                const text = await response.text();
                this.#parseFilterList(text);

                console.log(`[Blocker] Loaded ${listName}: ${this.#rules.size} rules`);
            } catch (e) {
                console.warn(`[Blocker] Failed to load ${listName}:`, e.message);
            }
        }

        await this.#saveCache();
    }

    // ─── Filter parsing ─────────────────────────────────

    #parseFilterList(text) {
        const lines = text.split("\n");

        for (const rawLine of lines) {
            const line = rawLine.trim();

            // Пропускаем комментарии и пустые
            if (!line || line.startsWith("!") || line.startsWith("[")) continue;

            // Cosmetic filter (##)
            if (line.includes("##")) {
                this.#parseCosmeticRule(line);
                continue;
            }

            // Exception rule (@@)
            if (line.startsWith("@@")) {
                const rule = this.#parseNetworkRule(line.slice(2));
                if (rule) this.#whitelistRules.add(rule);
                continue;
            }

            // Network rule
            const rule = this.#parseNetworkRule(line);
            if (rule) {
                // Если правило для конкретного домена
                if (rule.domain) {
                    if (!this.#domainRules.has(rule.domain)) {
                        this.#domainRules.set(rule.domain, new Set());
                    }
                    this.#domainRules.get(rule.domain).add(rule);
                } else {
                    this.#rules.add(rule);
                }
            }
        }
    }

    #parseNetworkRule(line) {
        // Упрощённый парсер (покрывает ~90% правил EasyList)
        let pattern = line;
        let domain = null;

        // Опции после $
        const dollarIndex = line.indexOf("$");
        if (dollarIndex !== -1) {
            const options = line.slice(dollarIndex + 1);
            pattern = line.slice(0, dollarIndex);

            // Извлекаем domain
            const domainMatch = options.match(/domain=([^,|]+)/);
            if (domainMatch) {
                domain = domainMatch[1].replace("~", "");
            }
        }

        if (!pattern || pattern.length < 3) return null;

        // Конвертируем AdBlock синтаксис в regex
        let regex;
        try {
            let regexStr = pattern
                .replace(/\*/g, ".*")           // * → .*
                .replace(/\^/g, "[^\\w.%-]")    // ^ → separator
                .replace(/\|\|/g, "^https?://([a-z0-9-]+\\.)*") // || → domain anchor
                .replace(/^\|/, "^")             // | at start → string start
                .replace(/\|$/, "$");            // | at end → string end

            // Escape special regex chars that aren't part of our syntax
            regexStr = regexStr.replace(/([[\]{}()+?.\\])/g, "\\$1");

            regex = new RegExp(regexStr, "i");
        } catch {
            return null; // Invalid regex
        }

        return { pattern, regex, domain };
    }

    #parseCosmeticRule(line) {
        const [domains, selector] = line.split("##", 2);
        if (!selector) return;

        if (!domains) {
            // Общее правило
            if (!this.#cosmeticRules.has("*")) {
                this.#cosmeticRules.set("*", []);
            }
            this.#cosmeticRules.get("*").push(selector);
        } else {
            for (const d of domains.split(",")) {
                const domain = d.trim();
                if (domain.startsWith("~")) continue; // exception
                if (!this.#cosmeticRules.has(domain)) {
                    this.#cosmeticRules.set(domain, []);
                }
                this.#cosmeticRules.get(domain).push(selector);
            }
        }
    }

    // ─── Rule matching ──────────────────────────────────

    #matchRule(url, rule) {
        if (!rule || !rule.regex) return false;
        return rule.regex.test(url);
    }

    // ─── Cache ──────────────────────────────────────────

    async #loadCached() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, DB_FILE);
            const data = await IOUtils.readJSON(path);

            if (data.rules) {
                for (const r of data.rules) {
                    try {
                        this.#rules.add({ ...r, regex: new RegExp(r.regexStr, "i") });
                    } catch {}
                }
            }

            if (data.stats) this.#stats = data.stats;
        } catch {
            // No cache
        }
    }

    async #saveCache() {
        const path = PathUtils.join(PathUtils.profileDir, DB_FILE);

        const rules = Array.from(this.#rules).slice(0, 50000).map(r => ({
            pattern: r.pattern,
            regexStr: r.regex?.source || "",
            domain: r.domain || null,
        }));

        await IOUtils.writeJSON(path, {
            rules,
            stats: this.#stats,
            updated: Date.now(),
        });
    }
}

export const phantomBlocker = new BlockerEngine();
