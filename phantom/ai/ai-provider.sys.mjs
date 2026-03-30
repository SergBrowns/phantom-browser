/**
 * Phantom AI Provider
 * Поддержка Anthropic, OpenAI, Ollama (локальный)
 * Без телеметрии — всё через ваш ключ
 */

export class PhantomAIProvider {
    #provider = "";   // "anthropic" | "openai" | "ollama"
    #apiKey = "";
    #model = "";
    #ollamaUrl = "";
    #configured = false;

    get configured() { return this.#configured; }
    get providerName() {
        if (!this.#configured) return "Not configured";
        const names = { anthropic: "Anthropic Claude", openai: "OpenAI GPT", ollama: "Ollama (local)" };
        return names[this.#provider] || this.#provider;
    }

    /**
     * Загрузить настройки из Firefox prefs
     */
    loadSettings() {
        try {
            this.#provider = Services.prefs.getStringPref("phantom.ai.provider", "");
            this.#apiKey = Services.prefs.getStringPref("phantom.ai.apiKey", "");
            this.#model = Services.prefs.getStringPref("phantom.ai.model", "");
            this.#ollamaUrl = Services.prefs.getStringPref("phantom.ai.ollamaUrl", "http://localhost:11434");

            this.#configured = !!this.#provider && (!!this.#apiKey || this.#provider === "ollama");

            // Дефолтные модели
            if (!this.#model) {
                switch (this.#provider) {
                    case "anthropic": this.#model = "claude-sonnet-4-6"; break;
                    case "openai":    this.#model = "gpt-4o"; break;
                    case "ollama":    this.#model = "llama3.1"; break;
                }
            }
        } catch (e) {
            console.warn("[AI] Failed to load settings:", e.message);
        }
    }

    /**
     * Отправить запрос к AI
     */
    async complete(systemPrompt, userMessage) {
        if (!this.#configured) {
            throw new Error("AI not configured. Go to Settings → Phantom AI.");
        }

        switch (this.#provider) {
            case "anthropic": return this.#callAnthropic(systemPrompt, userMessage);
            case "openai":    return this.#callOpenAI(systemPrompt, userMessage);
            case "ollama":    return this.#callOllama(systemPrompt, userMessage);
            default: throw new Error(`Unknown provider: ${this.#provider}`);
        }
    }

    // ─── Anthropic (Claude) ─────────────────────────────

    async #callAnthropic(system, userMessage) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.#apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: this.#model,
                max_tokens: 4096,
                system,
                messages: [
                    { role: "user", content: userMessage },
                ],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error: ${response.status} ${err}`);
        }

        const data = await response.json();
        return data.content?.[0]?.text || "";
    }

    // ─── OpenAI ─────────────────────────────────────────

    async #callOpenAI(system, userMessage) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.#apiKey}`,
            },
            body: JSON.stringify({
                model: this.#model,
                max_tokens: 4096,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: userMessage },
                ],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${err}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    }

    // ─── Ollama (local) ─────────────────────────────────

    async #callOllama(system, userMessage) {
        const response = await fetch(`${this.#ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: this.#model,
                stream: false,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: userMessage },
                ],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Ollama error: ${response.status} ${err}`);
        }

        const data = await response.json();
        return data.message?.content || "";
    }
}

export const phantomAI = new PhantomAIProvider();
