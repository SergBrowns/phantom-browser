/**
 * Phantom Diagnostics Exporter
 * Собирает анонимную диагностику по запросу пользователя.
 * Ничего не отправляется автоматически — только экспорт в файл.
 */

const PHANTOM_VERSION = "151.0a1";
const ISSUES_URL = "https://github.com/SergBrowns/phantom-browser/issues/new";

export async function exportDiagnostics() {
    const lines = [];
    const push = (...args) => lines.push(...args);

    push("=== Phantom Browser Diagnostics ===");
    push(`Generated: ${new Date().toISOString()}`);
    push(`Version: ${PHANTOM_VERSION}`);
    push("");

    // ── Платформа ────────────────────────────────────────────────
    push("--- Platform ---");
    try {
        const sysInfo = Cc["@mozilla.org/system-info;1"].getService(Ci.nsIPropertyBag2);
        push(`OS: ${sysInfo.getProperty("name")} ${sysInfo.getProperty("version")}`);
        push(`Arch: ${sysInfo.getProperty("arch")}`);
        push(`CPUs: ${sysInfo.getProperty("cpucount")}`);
        push(`Memory: ${Math.round(sysInfo.getProperty("memsize") / 1024 / 1024)} MB`);
    } catch (e) {
        push(`Platform error: ${e.message}`);
    }
    push("");

    // ── Phantom-настройки (без секретов) ─────────────────────────
    push("--- Phantom Config ---");
    const safePrefKeys = [
        "phantom.dpi.enabled", "phantom.dpi.strategy",
        "phantom.dpi.doh.provider", "phantom.dpi.bypass.all",
        "phantom.vpn.enabled", "phantom.vpn.autoConnect",
        "phantom.vpn.socksPort", "phantom.vpn.httpPort",
        "phantom.proxy.enabled", "phantom.proxy.failover",
        "phantom.blocker.enabled",
        "phantom.smarthistory.enabled", "phantom.smarthistory.maxAgeDays",
        "phantom.spaces.enabled", "phantom.ai.enabled", "phantom.ai.provider",
        "network.trr.mode", "network.trr.uri",
        "network.cookie.cookieBehavior",
        "dom.security.https_only_mode",
        "privacy.resistFingerprinting",
    ];
    for (const key of safePrefKeys) {
        try {
            const val = Services.prefs.getPrefType(key) === Services.prefs.PREF_BOOL
                ? Services.prefs.getBoolPref(key)
                : Services.prefs.getStringPref(key, "<unset>");
            push(`  ${key} = ${val}`);
        } catch {
            push(`  ${key} = <error>`);
        }
    }
    // API-ключ никогда не включаем
    push("  phantom.ai.apiKey = <redacted>");
    push("");

    // ── VPN-статус ────────────────────────────────────────────────
    push("--- VPN ---");
    try {
        const { phantomVPN } = ChromeUtils.importESModule(
            "resource://phantom/vpn/vpn-engine.sys.mjs"
        );
        const stats = phantomVPN.stats;
        push(`  sing-box found: ${phantomVPN.singboxFound}`);
        push(`  running: ${phantomVPN.running}`);
        push(`  servers: ${stats.serverCount}`);
        push(`  active server: ${phantomVPN.activeServer?.name || "none"}`);
        // URL подписки не включаем — может содержать токены
        push(`  subscription configured: ${!!phantomVPN.subscriptionUrl}`);
        if (phantomVPN.lastError) push(`  last error: ${phantomVPN.lastError}`);
    } catch (e) {
        push(`  VPN error: ${e.message}`);
    }
    push("");

    // ── Blocker-статус ────────────────────────────────────────────
    push("--- Blocker ---");
    try {
        const { phantomBlocker } = ChromeUtils.importESModule(
            "resource://phantom/blocker/blocker-engine.sys.mjs"
        );
        const stats = phantomBlocker.stats;
        push(`  rules: ${phantomBlocker.ruleCount}`);
        push(`  blocked: ${stats.blocked}`);
        push(`  total requests: ${stats.total}`);
    } catch (e) {
        push(`  Blocker error: ${e.message}`);
    }
    push("");

    // ── Proxy-статус ──────────────────────────────────────────────
    push("--- Proxy ---");
    try {
        const { phantomProxy } = ChromeUtils.importESModule(
            "resource://phantom/proxy/proxy-manager.sys.mjs"
        );
        push(`  enabled: ${phantomProxy.enabled}`);
        push(`  profiles: ${phantomProxy.getProfiles().length}`);
        push(`  active: ${phantomProxy.activeProfileId || "none"}`);
        // Учётные данные не включаем
    } catch (e) {
        push(`  Proxy error: ${e.message}`);
    }
    push("");

    // ── Браузерная консоль (последние ошибки) ────────────────────
    push("--- Recent Console Errors ---");
    try {
        const consoleService = Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService);
        const messages = consoleService.getMessageArray();
        const errors = messages
            .filter(m => {
                try { return m instanceof Ci.nsIScriptError && m.flags & Ci.nsIScriptError.errorFlag; }
                catch { return false; }
            })
            .slice(-20);
        if (errors.length === 0) {
            push("  (none)");
        } else {
            for (const e of errors) {
                push(`  [${new Date(e.timeStamp).toISOString()}] ${e.errorMessage} @ ${e.sourceName}:${e.lineNumber}`);
            }
        }
    } catch (e) {
        push(`  Console error: ${e.message}`);
    }
    push("");
    push("=== End of Diagnostics ===");
    push("");
    push(`Report an issue: ${ISSUES_URL}`);

    return lines.join("\n");
}

export async function saveDiagnosticsToFile() {
    const text = await exportDiagnostics();

    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const window = Services.wm.getMostRecentWindow("navigator:browser");
    fp.init(window.browsingContext, "Save Diagnostics", Ci.nsIFilePicker.modeSave);
    fp.appendFilter("Text Files", "*.txt");
    fp.defaultString = `phantom-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;

    const result = await new Promise(resolve => fp.open(resolve));
    if (result === Ci.nsIFilePicker.returnCancel) return null;

    const file = fp.file;
    await IOUtils.writeUTF8(file.path, text);
    return file.path;
}
