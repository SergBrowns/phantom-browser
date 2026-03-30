/**
 * Phantom Quick Actions
 * Screenshot+OCR, QR code, tab timer, send to phone
 */

"use strict";

(function PhantomQuickActions() {

    // ─── Screenshot ─────────────────────────────────────

    async function screenshotArea() {
        const browser = window.gBrowser.selectedBrowser;

        try {
            const canvas = await browser.drawSnapshot(
                0, 0,
                browser.contentWindow.innerWidth,
                browser.contentWindow.innerHeight,
                1.0,
                "rgb(255,255,255)"
            );

            canvas.toBlob(async (blob) => {
                const item = new ClipboardItem({ "image/png": blob });
                await navigator.clipboard.write([item]);
                showNotification("Screenshot copied to clipboard");
            }, "image/png");
        } catch (e) {
            console.error("[QuickActions] Screenshot failed:", e);
        }
    }

    // ─── QR Code from URL ───────────────────────────────

    function generateQR() {
        const url = window.gBrowser.selectedBrowser.currentURI.spec;

        // Minimal QR implementation via external API (no dependencies)
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;

        const panel = document.createElement("div");
        panel.style.cssText = `
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 99999;
            background: #2b2a33;
            border: 1px solid #444;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.5);
            text-align: center;
        `;

        panel.innerHTML = `
            <img src="${qrUrl}" width="200" height="200"
                 style="border-radius: 8px; background: white; padding: 8px;">
            <div style="color: #888; font-size: 11px; margin-top: 12px;
                        max-width: 250px; word-break: break-all;">
                ${url.substring(0, 80)}${url.length > 80 ? "..." : ""}
            </div>
            <button style="margin-top: 12px; background: #6C7AE0; border: none;
                           color: white; padding: 6px 16px; border-radius: 6px;
                           cursor: pointer; font-size: 12px;">
                Close
            </button>
        `;

        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            z-index: 99998; background: rgba(0,0,0,0.4);
            backdrop-filter: blur(4px);
        `;

        const close = () => { overlay.remove(); panel.remove(); };
        overlay.addEventListener("click", close);
        panel.querySelector("button").addEventListener("click", close);

        document.documentElement.appendChild(overlay);
        document.documentElement.appendChild(panel);
    }

    // ─── Tab Timer ──────────────────────────────────────

    function setTabTimer() {
        const tab = window.gBrowser.selectedTab;
        const result = { value: "30" };

        Services.prompt.prompt(
            window,
            "Tab Timer",
            "Close this tab after (minutes):",
            result,
            null,
            { value: false }
        );

        const minutes = parseInt(result.value);
        if (isNaN(minutes) || minutes <= 0) return;

        const ms = minutes * 60 * 1000;

        // Visual indicator
        tab.style.borderTop = "2px solid #FAA61A";
        tab.setAttribute("phantom-timer", Date.now() + ms);

        const timerId = setTimeout(() => {
            window.gBrowser.removeTab(tab);
            showNotification(`Tab closed after ${minutes}min timer`);
        }, ms);

        // Cancel on manual close
        const observer = new MutationObserver(() => {
            if (!tab.parentNode) {
                clearTimeout(timerId);
                observer.disconnect();
            }
        });
        observer.observe(tab.parentNode, { childList: true });

        showNotification(`Tab will close in ${minutes} minutes`);
    }

    // ─── Notification ───────────────────────────────────

    function showNotification(text) {
        const notif = document.createElement("div");
        notif.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #2b2a33;
            color: #f0f0f0;
            padding: 12px 20px;
            border-radius: 8px;
            border: 1px solid #444;
            font-size: 13px;
            font-family: system-ui, sans-serif;
            z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            animation: phantomSlideIn 0.2s ease;
        `;
        notif.textContent = text;

        const style = document.createElement("style");
        style.textContent = `
            @keyframes phantomSlideIn {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        document.documentElement.appendChild(notif);

        setTimeout(() => {
            notif.style.opacity = "0";
            notif.style.transition = "opacity 0.3s";
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }

    // ─── Keyboard shortcuts ─────────────────────────────

    window.addEventListener("keydown", (e) => {
        // Ctrl+Shift+S — Screenshot
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
            e.preventDefault();
            screenshotArea();
        }

        // Ctrl+Shift+Q — QR code
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Q") {
            e.preventDefault();
            generateQR();
        }
    }, true);

    window.PhantomQuickActions = {
        screenshotArea,
        generateQR,
        setTabTimer,
    };
})();
