/**
 * Phantom Cookie Killer
 * Автоматически нажимает "Reject All" / "Decline" на cookie-баннерах
 */

"use strict";

(function PhantomCookieKiller() {

    // Селекторы кнопок отклонения cookie
    const REJECT_SELECTORS = [
        // Текст кнопок
        'button[id*="reject"]',
        'button[class*="reject"]',
        'a[id*="reject"]',
        'button[id*="decline"]',
        'button[class*="decline"]',
        'button[id*="deny"]',
        'button[class*="deny"]',

        // Популярные CMP (Consent Management Platforms)
        // OneTrust
        '#onetrust-reject-all-handler',
        '.onetrust-close-btn-handler',

        // Cookiebot
        '#CybotCookiebotDialogBodyButtonDecline',
        '#CybotCookiebotDialogBodyLevelButtonDecline',

        // TrustArc / TRUSTe
        '.truste_popframe .decline',

        // Quantcast
        '.qc-cmp2-summary-buttons button[mode="secondary"]',
        '.qc-cmp-button[onclick*="reject"]',

        // GDPR generic
        '[data-testid="cookie-policy-manage-dialog-btn-decline"]',
        '[data-gdpr="reject"]',
        '[data-consent="reject"]',

        // "Necessary only" buttons
        'button[class*="necessary"]',
        'button[id*="necessary-only"]',
    ];

    // Текстовые паттерны для кнопок отклонения
    const REJECT_TEXTS = [
        /^reject\s*(all)?$/i,
        /^decline\s*(all)?$/i,
        /^deny\s*(all)?$/i,
        /^refuse\s*(all)?$/i,
        /^(only\s+)?necessary$/i,
        /^necessary\s+only$/i,
        /^essential\s+only$/i,
        /^отклонить/i,
        /^отказаться/i,
        /^только\s+необходимые/i,
        /^alle\s+ablehnen/i,      // German
        /^tout\s+refuser/i,        // French
        /^rechazar\s+todo/i,       // Spanish
    ];

    // Селекторы cookie-баннеров
    const BANNER_SELECTORS = [
        '#onetrust-consent-sdk',
        '#onetrust-banner-sdk',
        '#CybotCookiebotDialog',
        '#cookie-banner',
        '#cookie-consent',
        '#gdpr-banner',
        '#gdpr-consent',
        '[class*="cookie-banner"]',
        '[class*="cookie-consent"]',
        '[class*="cookie-notice"]',
        '[class*="consent-banner"]',
        '[class*="gdpr"]',
        '[id*="cookie-banner"]',
        '[id*="cookie-consent"]',
        '[aria-label*="cookie"]',
        '[aria-label*="consent"]',
    ];

    function killCookies(doc) {
        try { if (!doc || !doc.body || !doc.defaultView) return; } catch { return; }

        // Попробовать нажать кнопку отклонения
        let clicked = false;

        // 1. По селекторам
        for (const sel of REJECT_SELECTORS) {
            try {
                const btn = doc.querySelector(sel);
                if (btn && isVisible(btn)) {
                    btn.click();
                    clicked = true;
                    console.debug("[CookieKiller] Clicked:", sel);
                    break;
                }
            } catch {}
        }

        // 2. По тексту кнопки
        if (!clicked) {
            const buttons = doc.querySelectorAll("button, a[role='button'], [class*='btn']");
            for (const btn of buttons) {
                const text = btn.textContent.trim();
                if (text.length > 50) continue; // не кнопка

                for (const pattern of REJECT_TEXTS) {
                    if (pattern.test(text) && isVisible(btn)) {
                        btn.click();
                        clicked = true;
                        console.debug("[CookieKiller] Clicked by text:", text);
                        break;
                    }
                }
                if (clicked) break;
            }
        }

        // 3. Если не нашли кнопку — скрыть баннер
        if (!clicked) {
            for (const sel of BANNER_SELECTORS) {
                try {
                    const banner = doc.querySelector(sel);
                    if (banner && isVisible(banner)) {
                        banner.style.display = "none";
                        console.debug("[CookieKiller] Hidden banner:", sel);

                        // Убрать overlay/backdrop
                        const overlay = doc.querySelector(".onetrust-background-overlay, [class*='consent-overlay'], [class*='cookie-overlay']");
                        if (overlay) overlay.style.display = "none";

                        // Восстановить скролл
                        doc.body.style.overflow = "";
                        doc.documentElement.style.overflow = "";

                        break;
                    }
                } catch {}
            }
        }
    }

    function isVisible(el) {
        if (!el) return false;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    }

    // ─── Hook into page loads ───────────────────────────

    function init() {
        window.gBrowser.addTabsProgressListener({
            onStateChange(browser, webProgress, request, stateFlags) {
                if (!webProgress.isTopLevel) return;

                const STATE_STOP = Ci.nsIWebProgressListener.STATE_STOP;
                const STATE_IS_NETWORK = Ci.nsIWebProgressListener.STATE_IS_NETWORK;

                if (!(stateFlags & STATE_STOP) || !(stateFlags & STATE_IS_NETWORK)) return;

                // Несколько попыток с задержкой (баннеры часто грузятся с задержкой)
                const doc = browser.contentDocument;
                setTimeout(() => killCookies(doc), 1000);
                setTimeout(() => killCookies(doc), 3000);
                setTimeout(() => killCookies(doc), 6000);
            }
        });

        // MutationObserver для динамически загружаемых баннеров
        window.gBrowser.tabContainer.addEventListener("TabSelect", () => {
            const doc = window.gBrowser.selectedBrowser.contentDocument;
            if (doc) {
                setTimeout(() => killCookies(doc), 500);
            }
        });
    }

    if (document.readyState === "complete") init(); else window.addEventListener("load", init, { once: true });
})();
