/**
 * Phantom Smart History — indexer
 * Saves page text to FTS5 index for full-text search
 */

import { Sqlite } from "resource://gre/modules/Sqlite.sys.mjs";

const DB_FILE = "phantom-history.sqlite";

export class HistoryIndexer {
    #db = null;
    #initialized = false;

    async init() {
        const dbPath = PathUtils.join(PathUtils.profileDir, DB_FILE);

        this.#db = await Sqlite.openConnection({
            path: dbPath,
            sharedMemoryCache: false,
        });

        // Performance: WAL mode + relaxed sync for faster writes
        await this.#db.execute("PRAGMA journal_mode = WAL");
        await this.#db.execute("PRAGMA synchronous = NORMAL");
        await this.#db.execute("PRAGMA cache_size = 5000");
        await this.#db.execute("PRAGMA temp_store = MEMORY");

        await this.#db.execute(`
            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                title TEXT,
                content TEXT,
                domain TEXT,
                category TEXT DEFAULT 'other',
                visit_time INTEGER NOT NULL,
                time_spent INTEGER DEFAULT 0,
                word_count INTEGER DEFAULT 0
            )
        `);

        await this.#db.execute(`
            CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts4(
                title, content, domain, category,
                content=pages,
                tokenize=unicode61
            )
        `);

        // Triggers for FTS sync
        await this.#db.execute(`
            CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
                INSERT INTO pages_fts(rowid, title, content, domain, category)
                VALUES (new.id, new.title, new.content, new.domain, new.category);
            END
        `);

        await this.#db.execute(`
            CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
                INSERT INTO pages_fts(pages_fts, rowid, title, content, domain, category)
                VALUES ('delete', old.id, old.title, old.content, old.domain, old.category);
            END
        `);

        await this.#db.execute(`
            CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)
        `);

        await this.#db.execute(`
            CREATE INDEX IF NOT EXISTS idx_pages_time ON pages(visit_time DESC)
        `);

        this.#initialized = true;
    }

    /**
     * Index a page
     */
    async indexPage({ url, title, content, domain }) {
        if (!this.#initialized || !content || content.length < 50) return;

        if (url.startsWith("about:") || url.startsWith("chrome:") ||
            url.startsWith("resource:") || url.startsWith("moz-extension:")) {
            return;
        }

        const trimmedContent = content.substring(0, 10000);
        const wordCount = trimmedContent.split(/\s+/).length;
        const category = this.#categorize(url, title, trimmedContent);

        await this.#db.execute(`
            INSERT INTO pages (url, title, content, domain, category, visit_time, word_count)
            VALUES (:url, :title, :content, :domain, :category, :time, :wordCount)
        `, {
            url,
            title: title || "",
            content: trimmedContent,
            domain: domain || new URL(url).hostname,
            category,
            time: Date.now(),
            wordCount,
        });
    }

    /**
     * Full-text search
     */
    async search(query, limit = 20) {
        if (!this.#initialized) return [];

        const rows = await this.#db.execute(`
            SELECT p.url, p.title, p.domain, p.category, p.visit_time, p.word_count,
                   snippet(pages_fts, '<b>', '</b>', '...', -1, 40) AS snippet
            FROM pages_fts
            JOIN pages p ON p.id = pages_fts.rowid
            WHERE pages_fts MATCH :query
            LIMIT :limit
        `, { query, limit });

        return rows.map(r => ({
            url: r.getResultByName("url"),
            title: r.getResultByName("title"),
            domain: r.getResultByName("domain"),
            category: r.getResultByName("category"),
            visitTime: r.getResultByName("visit_time"),
            wordCount: r.getResultByName("word_count"),
            snippet: r.getResultByName("snippet"),
        }));
    }

    /**
     * Timeline — what was read, when
     */
    async getTimeline(days = 7, limit = 100) {
        if (!this.#initialized) return [];

        const since = Date.now() - (days * 24 * 60 * 60 * 1000);

        const rows = await this.#db.execute(`
            SELECT url, title, domain, category, visit_time, word_count
            FROM pages
            WHERE visit_time > :since
            ORDER BY visit_time DESC
            LIMIT :limit
        `, { since, limit });

        return rows.map(r => ({
            url: r.getResultByName("url"),
            title: r.getResultByName("title"),
            domain: r.getResultByName("domain"),
            category: r.getResultByName("category"),
            visitTime: r.getResultByName("visit_time"),
            wordCount: r.getResultByName("word_count"),
        }));
    }

    /**
     * Stats by category
     */
    async getStats(days = 7) {
        if (!this.#initialized) return {};

        const since = Date.now() - (days * 24 * 60 * 60 * 1000);

        const rows = await this.#db.execute(`
            SELECT category, COUNT(*) as count, SUM(word_count) as words
            FROM pages
            WHERE visit_time > :since
            GROUP BY category
            ORDER BY count DESC
        `, { since });

        const stats = {};
        for (const r of rows) {
            stats[r.getResultByName("category")] = {
                count: r.getResultByName("count"),
                words: r.getResultByName("words"),
            };
        }
        return stats;
    }

    /**
     * Cleanup old entries
     */
    async cleanup(maxAgeDays = 90) {
        const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
        await this.#db.execute(`DELETE FROM pages WHERE visit_time < :cutoff`, { cutoff });
    }

    // ─── Auto-categorize ────────────────────────────────

    #categorize(url, title, content) {
        const text = `${url} ${title} ${content.substring(0, 500)}`.toLowerCase();

        const categories = [
            { name: "dev",           patterns: /github|stackoverflow|docs\.|api\.|developer|programming|code|javascript|python|rust/ },
            { name: "docs",          patterns: /documentation|wiki|reference|manual|guide|tutorial/ },
            { name: "news",          patterns: /news|article|blog|post|press|media|reuters|bbc|cnn/ },
            { name: "shopping",      patterns: /shop|store|buy|price|cart|amazon|ebay|aliexpress|product/ },
            { name: "social",        patterns: /twitter|reddit|facebook|instagram|telegram|discord|slack/ },
            { name: "video",         patterns: /youtube|vimeo|twitch|video|watch|stream/ },
            { name: "work",          patterns: /jira|confluence|notion|slack|trello|asana|linear|figma/ },
            { name: "entertainment", patterns: /game|play|movie|music|anime|manga|comic/ },
            { name: "finance",       patterns: /bank|finance|crypto|trading|invest|stock|payment/ },
            { name: "education",     patterns: /course|learn|lecture|university|academy|study/ },
        ];

        for (const cat of categories) {
            if (cat.patterns.test(text)) return cat.name;
        }

        return "other";
    }

    async close() {
        if (this.#db) await this.#db.close();
    }
}

export const phantomHistory = new HistoryIndexer();
