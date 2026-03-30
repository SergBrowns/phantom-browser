/**
 * Phantom Focus Mode
 * F9 — скрывает весь браузерный chrome, оставляет только контент
 * Повторное F9 — возвращает обратно
 */

"use strict";

(function PhantomFocusMode() {
    let active = false;

    const STYLE = `
        body.phantom-focus #navigator-toolbox,
        body.phantom-focus #phantom-spaces-bar,
        body.phantom-focus #phantom-vtabs,
        body.phantom-focus #sidebar-box,
        body.phantom-focus #sidebar-splitter,
        body.phantom-focus #phantom-split-divider {
            display: none !important;
        }

        body.phantom-focus #browser {
            border-radius: 0 !important;
        }

        #phantom-focus-indicator {
            display: none;
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(20, 20, 30, 0.85);
            backdrop-filter: blur(8px);
            color: #aaa;
            font-size: 12px;
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.1);
            z-index: 99999;
            pointer-events: none;
            font-family: system-ui, sans-serif;
            animation: phantom-fadeout 2.5s forwards;
        }

        @keyframes phantom-fadeout {
            0%   { opacity: 1; }
            60%  { opacity: 1; }
            100% { opacity: 0; }
        }
    `;

    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    function showToast(text) {
        let toast = document.getElementById("phantom-focus-indicator");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "phantom-focus-indicator";
            document.documentElement.appendChild(toast);
        }
        toast.textContent = text;
        toast.style.display = "block";
        toast.style.animation = "none";
        toast.offsetHeight; // reflow
        toast.style.animation = "phantom-fadeout 2.5s forwards";
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => { toast.style.display = "none"; }, 2600);
    }

    function enter() {
        active = true;
        document.body.classList.add("phantom-focus");
        showToast("Focus Mode · Press F9 to exit");
    }

    function exit() {
        active = false;
        document.body.classList.remove("phantom-focus");
        showToast("Focus Mode off");
    }

    function toggle() {
        if (active) exit();
        else enter();
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "F9" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            toggle();
        }
    }, true);

    if (document.readyState === "complete") injectStyles(); else window.addEventListener("load", injectStyles, { once: true });

    window.PhantomFocusMode = { toggle, enter, exit, get active() { return active; } };
})();
