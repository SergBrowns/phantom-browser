/**
 * Phantom Spaces — инициализация менеджера пространств
 * UI и keyboard shortcuts теперь в vertical-tabs/vertical-tabs.js
 */

"use strict";

(function PhantomSpacesInit() {
    const { phantomSpaces } = ChromeUtils.importESModule(
        "resource://phantom/spaces/spaces-manager.sys.mjs"
    );

    // Init запускается из вертикального sidebar-а.
    // Здесь только экспортируем API для других модулей.
    window.phantomSpaces = phantomSpaces;
})();
