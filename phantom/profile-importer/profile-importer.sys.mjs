/**
 * Phantom Profile Importer
 * Импорт закладок, истории, паролей и кук из профиля Firefox.
 * Использует встроенный Firefox MigrationUtils — он правильно обрабатывает
 * блокировки SQLite и шифрование паролей.
 */

"use strict";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
    MigrationUtils: "resource:///modules/MigrationUtils.sys.mjs",
});

/**
 * Возвращает список профилей Firefox, доступных для импорта.
 * @returns {Promise<Array<{id, name, path, isDefault}>>}
 */
export async function getFirefoxProfiles() {
    try {
        // MigrationUtils.getMigratorProfiles работает только синхронно,
        // поэтому создаём мигратор напрямую.
        const migrator = await lazy.MigrationUtils.getMigrator("firefox");
        if (!migrator) return [];

        const sourceProfiles = await migrator.getSourceProfiles();
        if (!sourceProfiles) return [];

        return sourceProfiles.map(p => ({
            id:        p.id,
            name:      p.name || p.id,
            path:      p.path?.path ?? "",
            isDefault: !!p.default,
        }));
    } catch (e) {
        console.error("[PhantomImporter] getFirefoxProfiles failed:", e);
        return [];
    }
}

/**
 * Открывает стандартный мастер миграции Firefox в заданном окне.
 * Пользователь сам выбирает профиль и нужные данные.
 * @param {Window} win  — chrome-окно браузера
 */
export function showImportWizard(win) {
    lazy.MigrationUtils.showMigrationWizard(win, {
        entrypoint: lazy.MigrationUtils.MIGRATION_ENTRYPOINT_ABOUT_WELCOME,
        migratorKey: "firefox",
    });
}

/**
 * Тихий импорт конкретного профиля без UI.
 * @param {string}   profileId   — id профиля из getFirefoxProfiles()
 * @param {string[]} resources   — список типов: "bookmarks","history","passwords","cookies"
 * @returns {Promise<{ok: boolean, imported: string[], errors: string[]}>}
 */
export async function importProfile(profileId, resources) {
    const result = { ok: false, imported: [], errors: [] };

    try {
        const migrator = await lazy.MigrationUtils.getMigrator("firefox");
        if (!migrator) throw new Error("Firefox migrator not available");

        const profiles = await migrator.getSourceProfiles();
        const profile  = profiles?.find(p => p.id === profileId);
        if (!profile) throw new Error(`Profile "${profileId}" not found`);

        // Строим битовую маску из запрошенных ресурсов
        const { resourceTypes } = lazy.MigrationUtils;
        const RESOURCE_MAP = {
            bookmarks: resourceTypes.BOOKMARKS,
            history:   resourceTypes.HISTORY,
            passwords: resourceTypes.PASSWORDS,
            cookies:   resourceTypes.COOKIES,
        };

        let mask = 0;
        for (const r of resources) {
            if (RESOURCE_MAP[r] !== undefined) {
                mask |= RESOURCE_MAP[r];
            } else {
                result.errors.push(`Unknown resource type: "${r}"`);
            }
        }

        if (!mask) throw new Error("No valid resource types specified");

        await lazy.MigrationUtils.migrate(mask, migrator, profile);

        result.ok       = true;
        result.imported = resources.filter(r => RESOURCE_MAP[r] !== undefined);
    } catch (e) {
        result.errors.push(e.message);
        console.error("[PhantomImporter] importProfile failed:", e);
    }

    return result;
}
