/**
 * Phantom Profile Importer — Chrome Hook
 * Добавляет "Import from Firefox" в Command Palette и меню Tools.
 */

"use strict";

(function PhantomProfileImporterHook() {
    const { showImportWizard } = ChromeUtils.importESModule(
        "resource://phantom/profile-importer/profile-importer.sys.mjs"
    );

    // ── Command Palette action ───────────────────────────────────────────────

    function registerPaletteAction() {
        // Command Palette регистрирует внешние экшены через window.PhantomCommandPalette.registerAction
        // Ждём инициализации палитры, затем регистрируем
        function tryRegister() {
            if (window.PhantomCommandPalette?.registerAction) {
                window.PhantomCommandPalette.registerAction({
                    type:  "action",
                    title: "Import from Firefox",
                    icon:  "↓",
                    run:   () => showImportWizard(window),
                });
            } else {
                // Палитра ещё не готова — повторить после phantom-ready
                window.addEventListener("phantom-ready", tryRegister, { once: true });
            }
        }
        tryRegister();
    }

    // ── Tools menu item ──────────────────────────────────────────────────────

    function addMenuEntry() {
        // Ждём полной загрузки XUL-меню
        const toolsMenu = document.getElementById("menu_ToolsPopup");
        if (!toolsMenu) return;

        if (toolsMenu.querySelector("#phantom-import-menuitem")) return; // уже добавлен

        const separator = document.createElement("menuseparator");
        separator.id = "phantom-import-sep";

        const item = document.createElement("menuitem");
        item.id       = "phantom-import-menuitem";
        item.label    = "Import from Firefox…";
        item.accessKey = "I";
        item.addEventListener("command", () => showImportWizard(window));

        // Вставляем перед последним разделителем (перед настройками браузера)
        toolsMenu.appendChild(separator);
        toolsMenu.appendChild(item);
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init() {
        addMenuEntry();
        registerPaletteAction();
    }

    if (document.readyState === "complete") {
        init();
    } else {
        window.addEventListener("load", init, { once: true });
    }
})();
