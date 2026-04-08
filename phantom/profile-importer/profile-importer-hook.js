/**
 * Phantom Profile Importer — UI Hook
 * Панель импорта из Firefox с выбором профиля и прогрессом.
 */

"use strict";

(function PhantomProfileImporterHook() {

    const {
        getFirefoxProfiles,
        importBookmarks,
        importHistory,
        importCookies,
    } = ChromeUtils.importESModule(
        "resource://phantom/profile-importer/profile-importer.sys.mjs"
    );

    let panelOpen = false;
    let importing = false;

    // ── Styles ──────────────────────────────────────────────────────────────

    const STYLES = `
        #ph-import-backdrop {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px); z-index: 99998; display: none;
        }
        #ph-import-backdrop.open { display: block; }

        #ph-import-panel {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 460px; background: #111827;
            border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
            box-shadow: 0 24px 80px rgba(0,0,0,0.7);
            z-index: 99999; font-family: -apple-system, "Segoe UI", sans-serif;
            color: #e2e8f0; font-size: 13px; display: none;
        }
        #ph-import-panel.open { display: block; }

        .ph-imp-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .ph-imp-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: #f1f5f9; }
        .ph-imp-close {
            background: none; border: none; color: #6b7280; cursor: pointer;
            font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 5px;
        }
        .ph-imp-close:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }

        .ph-imp-body { padding: 18px 20px; }

        .ph-imp-label {
            font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
            color: #6b7280; font-weight: 600; margin-bottom: 8px;
        }

        .ph-imp-profiles { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }

        .ph-imp-profile {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px; border: 1px solid rgba(255,255,255,0.07);
            border-radius: 9px; cursor: pointer; transition: all 0.15s;
        }
        .ph-imp-profile:hover { background: rgba(255,255,255,0.04); }
        .ph-imp-profile.selected { border-color: #6366f1; background: rgba(99,102,241,0.08); }
        .ph-imp-profile input[type=radio] { accent-color: #6366f1; width: 15px; height: 15px; cursor: pointer; }
        .ph-imp-profile-info { flex: 1; }
        .ph-imp-profile-name { font-weight: 500; color: #e2e8f0; }
        .ph-imp-profile-path { font-size: 11px; color: #4b5563; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 330px; }
        .ph-imp-default-badge { font-size: 10px; background: rgba(99,102,241,0.15); color: #818cf8; border-radius: 4px; padding: 1px 6px; }

        .ph-imp-types { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
        .ph-imp-type {
            display: flex; align-items: center; gap: 6px;
            padding: 7px 12px; border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px; cursor: pointer; transition: all 0.15s;
            user-select: none;
        }
        .ph-imp-type:hover { background: rgba(255,255,255,0.04); }
        .ph-imp-type.checked { border-color: #22c55e; background: rgba(34,197,94,0.07); }
        .ph-imp-type input { accent-color: #22c55e; cursor: pointer; }
        .ph-imp-type span { font-size: 13px; color: #cbd5e1; }

        #ph-imp-progress-wrap { display: none; margin-bottom: 16px; }
        #ph-imp-progress-label { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
        #ph-imp-progress-bar-bg {
            height: 6px; background: rgba(255,255,255,0.06);
            border-radius: 3px; overflow: hidden;
        }
        #ph-imp-progress-bar { height: 100%; background: #6366f1; border-radius: 3px; width: 0%; transition: width 0.2s; }

        #ph-imp-result { display: none; padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; font-size: 12px; }
        #ph-imp-result.ok { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); color: #86efac; }
        #ph-imp-result.err { background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2); color: #fca5a5; }

        .ph-imp-footer {
            display: flex; gap: 8px; justify-content: flex-end;
            padding: 14px 20px; border-top: 1px solid rgba(255,255,255,0.07);
        }
        .ph-imp-btn {
            padding: 8px 18px; border-radius: 8px; border: none;
            font-size: 13px; font-weight: 500; cursor: pointer;
            font-family: inherit; transition: all 0.15s;
        }
        .ph-imp-btn.cancel { background: rgba(255,255,255,0.06); color: #94a3b8; border: 1px solid rgba(255,255,255,0.08); }
        .ph-imp-btn.cancel:hover { background: rgba(255,255,255,0.1); }
        .ph-imp-btn.import { background: #6366f1; color: #fff; }
        .ph-imp-btn.import:hover { background: #4f46e5; }
        .ph-imp-btn.import:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }

        #ph-import-no-profiles { color: #6b7280; font-size: 13px; padding: 8px 0; }
    `;

    // ── Panel ────────────────────────────────────────────────────────────────

    function initUI() {
        const style = document.createElement("style");
        style.textContent = STYLES;
        document.head.appendChild(style);

        const backdrop = document.createElement("div");
        backdrop.id = "ph-import-backdrop";
        backdrop.addEventListener("click", closePanel);
        document.documentElement.appendChild(backdrop);

        const panel = document.createElement("div");
        panel.id = "ph-import-panel";
        panel.addEventListener("click", e => e.stopPropagation());
        document.documentElement.appendChild(panel);
    }

    function esc(s) {
        return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    async function openPanel() {
        if (panelOpen) return;
        panelOpen = true;

        const panel = document.getElementById("ph-import-panel");
        const backdrop = document.getElementById("ph-import-backdrop");
        backdrop?.classList.add("open");

        panel.innerHTML = `
            <div class="ph-imp-header">
                <h3>Импорт из Firefox</h3>
                <button class="ph-imp-close" id="ph-imp-close-btn">×</button>
            </div>
            <div class="ph-imp-body">
                <div class="ph-imp-label">Профиль Firefox</div>
                <div class="ph-imp-profiles" id="ph-imp-profiles-list">
                    <div style="color:#6b7280;font-size:12px;">Поиск профилей…</div>
                </div>
                <div class="ph-imp-label">Что импортировать</div>
                <div class="ph-imp-types">
                    <label class="ph-imp-type checked" id="ph-type-bookmarks">
                        <input type="checkbox" value="bookmarks" checked /> <span>📚 Закладки</span>
                    </label>
                    <label class="ph-imp-type checked" id="ph-type-history">
                        <input type="checkbox" value="history" checked /> <span>🕐 История</span>
                    </label>
                    <label class="ph-imp-type" id="ph-type-cookies">
                        <input type="checkbox" value="cookies" /> <span>🍪 Cookies</span>
                    </label>
                </div>
                <div id="ph-imp-progress-wrap">
                    <div id="ph-imp-progress-label">Импорт…</div>
                    <div id="ph-imp-progress-bar-bg"><div id="ph-imp-progress-bar"></div></div>
                </div>
                <div id="ph-imp-result"></div>
            </div>
            <div class="ph-imp-footer">
                <button class="ph-imp-btn cancel" id="ph-imp-cancel-btn">Отмена</button>
                <button class="ph-imp-btn import" id="ph-imp-start-btn" disabled>Импортировать</button>
            </div>
        `;

        panel.classList.add("open");

        panel.querySelector("#ph-imp-close-btn").addEventListener("click", closePanel);
        panel.querySelector("#ph-imp-cancel-btn").addEventListener("click", closePanel);
        panel.querySelector("#ph-imp-start-btn").addEventListener("click", startImport);

        // Type checkbox styling
        panel.querySelectorAll(".ph-imp-type input").forEach(cb => {
            cb.addEventListener("change", () => {
                cb.closest(".ph-imp-type").classList.toggle("checked", cb.checked);
            });
        });

        // Load profiles
        const profiles = await getFirefoxProfiles();
        const listEl = panel.querySelector("#ph-imp-profiles-list");

        if (profiles.length === 0) {
            listEl.innerHTML = `<div id="ph-import-no-profiles">Профили Firefox не найдены (~/.mozilla/firefox/)</div>`;
        } else {
            listEl.innerHTML = profiles.map((p, i) => `
                <label class="ph-imp-profile ${i === 0 ? 'selected' : ''}" data-path="${esc(p.path)}">
                    <input type="radio" name="ff-profile" value="${esc(p.path)}" ${i === 0 ? 'checked' : ''} />
                    <div class="ph-imp-profile-info">
                        <div class="ph-imp-profile-name">
                            ${esc(p.name)}
                            ${p.isDefault ? '<span class="ph-imp-default-badge">по умолчанию</span>' : ''}
                        </div>
                        <div class="ph-imp-profile-path">${esc(p.path)}</div>
                    </div>
                </label>
            `).join("");

            listEl.querySelectorAll(".ph-imp-profile").forEach(card => {
                card.addEventListener("click", () => {
                    listEl.querySelectorAll(".ph-imp-profile").forEach(c => c.classList.remove("selected"));
                    card.classList.add("selected");
                    card.querySelector("input[type=radio]").checked = true;
                });
            });

            panel.querySelector("#ph-imp-start-btn").disabled = false;
        }
    }

    async function startImport() {
        if (importing) return;
        importing = true;

        const panel = document.getElementById("ph-import-panel");
        const startBtn = panel.querySelector("#ph-imp-start-btn");
        const cancelBtn = panel.querySelector("#ph-imp-cancel-btn");
        const progressWrap = panel.querySelector("#ph-imp-progress-wrap");
        const progressLabel = panel.querySelector("#ph-imp-progress-label");
        const progressBar = panel.querySelector("#ph-imp-progress-bar");
        const resultEl = panel.querySelector("#ph-imp-result");

        const profilePath = panel.querySelector("input[name=ff-profile]:checked")?.value;
        if (!profilePath) { importing = false; return; }

        const types = [...panel.querySelectorAll(".ph-imp-types input:checked")].map(cb => cb.value);
        if (types.length === 0) { importing = false; return; }

        startBtn.disabled = true;
        cancelBtn.disabled = true;
        resultEl.style.display = "none";
        progressWrap.style.display = "block";

        const totals = { imported: 0, errors: 0 };

        function onProgress({ phase, done, total }) {
            const phaseName = phase === "bookmarks" ? "закладки" : phase === "history" ? "история" : "cookies";
            progressLabel.textContent = `${phaseName}: ${done} / ${total}`;
            progressBar.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
        }

        try {
            if (types.includes("bookmarks")) {
                const r = await importBookmarks(profilePath, onProgress);
                totals.imported += r.imported; totals.errors += r.errors;
            }
            if (types.includes("history")) {
                const r = await importHistory(profilePath, onProgress);
                totals.imported += r.imported; totals.errors += r.errors;
            }
            if (types.includes("cookies")) {
                const r = await importCookies(profilePath, onProgress);
                totals.imported += r.imported; totals.errors += r.errors;
            }

            progressBar.style.width = "100%";
            progressLabel.textContent = "Готово!";

            resultEl.className = "ok";
            resultEl.textContent = `Импортировано: ${totals.imported} записей${totals.errors > 0 ? ` (${totals.errors} ошибок)` : ""}`;
            resultEl.style.display = "block";
        } catch (e) {
            resultEl.className = "err";
            resultEl.textContent = `Ошибка: ${e.message}`;
            resultEl.style.display = "block";
            console.error("[PhantomImporter] Import failed:", e);
        } finally {
            importing = false;
            startBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    }

    function closePanel() {
        if (importing) return;
        panelOpen = false;
        document.getElementById("ph-import-panel")?.classList.remove("open");
        document.getElementById("ph-import-backdrop")?.classList.remove("open");
    }

    // ── Registration ─────────────────────────────────────────────────────────

    function addMenuEntry() {
        const toolsMenu = document.getElementById("menu_ToolsPopup");
        if (!toolsMenu || toolsMenu.querySelector("#phantom-import-menuitem")) return;

        const sep  = document.createElement("menuseparator");
        const item = document.createElement("menuitem");
        item.id       = "phantom-import-menuitem";
        item.label    = "Импорт из Firefox…";
        item.accessKey = "I";
        item.addEventListener("command", () => openPanel());
        toolsMenu.appendChild(sep);
        toolsMenu.appendChild(item);
    }

    function registerPaletteAction() {
        function tryRegister() {
            if (window.PhantomCommandPalette?.registerAction) {
                window.PhantomCommandPalette.registerAction({
                    type:  "action",
                    title: "Import from Firefox",
                    icon:  "↓",
                    run:   () => openPanel(),
                });
            } else {
                window.addEventListener("phantom-ready", tryRegister, { once: true });
            }
        }
        tryRegister();
    }

    function init() {
        initUI();
        addMenuEntry();
        registerPaletteAction();
    }

    if (document.readyState === "complete") init();
    else window.addEventListener("load", init, { once: true });

})();
