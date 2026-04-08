/**
 * Phantom Profile Importer
 * Прямое чтение SQLite-баз Firefox — не зависит от MigrationUtils.
 * Копирует базу во временный файл перед чтением (обходит блокировку WAL).
 *
 * Поддерживает: закладки, история посещений, cookies.
 */

"use strict";

import { Sqlite } from "resource://gre/modules/Sqlite.sys.mjs";

const FIREFOX_PROFILES_DIR = (() => {
    try {
        const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
        return PathUtils.join(home, ".mozilla", "firefox");
    } catch { return ""; }
})();

// ── Profile discovery ──────────────────────────────────────────────────────

/**
 * Читает profiles.ini и возвращает список профилей Firefox.
 * @returns {Promise<Array<{id, name, path, isDefault}>>}
 */
export async function getFirefoxProfiles() {
    if (!FIREFOX_PROFILES_DIR) return [];

    const iniPath = PathUtils.join(FIREFOX_PROFILES_DIR, "profiles.ini");
    let iniText;
    try {
        iniText = await IOUtils.readUTF8(iniPath);
    } catch {
        return [];
    }

    const profiles = [];
    let current = null;

    for (const rawLine of iniText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (/^\[Profile\d+\]$/i.test(line)) {
            if (current) profiles.push(current);
            current = { id: "", name: "", path: "", isDefault: false };
        } else if (current) {
            const [key, ...rest] = line.split("=");
            const val = rest.join("=").trim();
            switch (key.trim().toLowerCase()) {
                case "name":      current.name      = val; break;
                case "path":      current.id        = val;
                                  current.path      = val.startsWith("/")
                                      ? val
                                      : PathUtils.join(FIREFOX_PROFILES_DIR, val);
                                  break;
                case "isrelative": if (val === "1" && current.id)
                                      current.path = PathUtils.join(FIREFOX_PROFILES_DIR, current.id);
                                   break;
                case "default":   current.isDefault = val === "1"; break;
            }
        }
    }
    if (current) profiles.push(current);

    // Убираем профили без пути и несуществующие
    const result = [];
    for (const p of profiles) {
        if (!p.path) continue;
        try {
            if (await IOUtils.exists(PathUtils.join(p.path, "places.sqlite"))) {
                if (!p.name) p.name = PathUtils.filename(p.path);
                result.push(p);
            }
        } catch {}
    }
    return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Копирует SQLite-файл во временную директорию.
 * Необходимо, если Firefox запущен и держит WAL-lock.
 */
async function copyDb(srcPath) {
    const tmpDir = PathUtils.join(PathUtils.tempDir, "phantom-import");
    await IOUtils.makeDirectory(tmpDir, { ignoreExisting: true });
    const dst = PathUtils.join(tmpDir, `${Date.now()}-${PathUtils.filename(srcPath)}`);
    await IOUtils.copy(srcPath, dst);
    // Копируем WAL и SHM если они есть (нужно для корректного чтения)
    for (const ext of ["-wal", "-shm"]) {
        try { await IOUtils.copy(srcPath + ext, dst + ext); } catch {}
    }
    return dst;
}

async function openReadonlyCopy(originalPath) {
    const copy = await copyDb(originalPath);
    const db = await Sqlite.openConnection({ path: copy, sharedMemoryCache: false });
    return { db, cleanup: async () => {
        await db.close();
        for (const ext of ["", "-wal", "-shm"]) {
            try { await IOUtils.remove(copy + ext); } catch {}
        }
    }};
}

// ── Bookmarks ──────────────────────────────────────────────────────────────

export async function importBookmarks(profilePath, onProgress) {
    const dbPath = PathUtils.join(profilePath, "places.sqlite");
    const { db, cleanup } = await openReadonlyCopy(dbPath);

    let imported = 0;
    let errors   = 0;

    try {
        // Читаем все закладки (type=1) вместе с URL
        const rows = await db.execute(`
            SELECT b.title, p.url
            FROM moz_bookmarks b
            JOIN moz_places p ON p.id = b.fk
            WHERE b.type = 1
              AND p.url NOT LIKE 'place:%'
              AND p.url NOT LIKE 'about:%'
              AND p.url LIKE 'http%'
            ORDER BY b.dateAdded DESC
            LIMIT 5000
        `);

        const total = rows.length;
        onProgress?.({ phase: "bookmarks", done: 0, total });

        for (let i = 0; i < rows.length; i++) {
            const url   = rows[i].getResultByName("url");
            const title = rows[i].getResultByName("title") || url;

            try {
                const uri = Services.io.newURI(url);
                await PlacesUtils.bookmarks.insert({
                    parentGuid: PlacesUtils.bookmarks.unfiledGuid,
                    url:   uri,
                    title: title,
                });
                imported++;
            } catch { errors++; }

            if (i % 50 === 0) onProgress?.({ phase: "bookmarks", done: i, total });
        }
    } finally {
        await cleanup();
    }

    return { imported, errors };
}

// ── History ────────────────────────────────────────────────────────────────

export async function importHistory(profilePath, onProgress) {
    const dbPath = PathUtils.join(profilePath, "places.sqlite");
    const { db, cleanup } = await openReadonlyCopy(dbPath);

    let imported = 0;
    let errors   = 0;

    try {
        const rows = await db.execute(`
            SELECT p.url, p.title, h.visit_date
            FROM moz_historyvisits h
            JOIN moz_places p ON p.id = h.place_id
            WHERE p.url LIKE 'http%'
            ORDER BY h.visit_date DESC
            LIMIT 10000
        `);

        const total = rows.length;
        onProgress?.({ phase: "history", done: 0, total });

        const pageInfos = [];
        for (const row of rows) {
            const url   = row.getResultByName("url");
            const title = row.getResultByName("title") || "";
            // Firefox хранит дату в микросекундах
            const visitDate = new Date(row.getResultByName("visit_date") / 1000);

            try {
                pageInfos.push({
                    url:   Services.io.newURI(url),
                    title: title,
                    visits: [{ date: visitDate, transition: PlacesUtils.history.TRANSITION_LINK }],
                });
            } catch {}
        }

        // Вставляем пачками по 200
        const BATCH = 200;
        for (let i = 0; i < pageInfos.length; i += BATCH) {
            try {
                await PlacesUtils.history.insertMany(pageInfos.slice(i, i + BATCH));
                imported += Math.min(BATCH, pageInfos.length - i);
            } catch { errors += Math.min(BATCH, pageInfos.length - i); }
            onProgress?.({ phase: "history", done: i, total });
        }
    } finally {
        await cleanup();
    }

    return { imported, errors };
}

// ── Cookies ───────────────────────────────────────────────────────────────

export async function importCookies(profilePath, onProgress) {
    const dbPath = PathUtils.join(profilePath, "cookies.sqlite");
    if (!await IOUtils.exists(dbPath)) return { imported: 0, errors: 0 };

    const { db, cleanup } = await openReadonlyCopy(dbPath);

    let imported = 0;
    let errors   = 0;

    try {
        const rows = await db.execute(`
            SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
            FROM moz_cookies
            WHERE expiry > :now
            LIMIT 3000
        `, { now: Math.floor(Date.now() / 1000) });

        const total = rows.length;
        onProgress?.({ phase: "cookies", done: 0, total });

        const cm = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager);

        for (let i = 0; i < rows.length; i++) {
            try {
                const r = rows[i];
                cm.add(
                    r.getResultByName("host"),
                    r.getResultByName("path"),
                    r.getResultByName("name"),
                    r.getResultByName("value"),
                    !!r.getResultByName("isSecure"),
                    !!r.getResultByName("isHttpOnly"),
                    false, // isSession
                    r.getResultByName("expiry"),
                    {}, // originAttributes
                    r.getResultByName("sameSite"),
                    Ci.nsICookie.SCHEME_HTTPS
                );
                imported++;
            } catch { errors++; }
            if (i % 100 === 0) onProgress?.({ phase: "cookies", done: i, total });
        }
    } finally {
        await cleanup();
    }

    return { imported, errors };
}
