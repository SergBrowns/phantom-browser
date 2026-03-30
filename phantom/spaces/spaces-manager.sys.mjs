/**
 * Phantom Spaces Manager
 * Spaces как визуальные группы вкладок.
 * Принадлежность вкладки к space хранится в атрибуте phantom-space на XUL-элементе.
 */

const SPACE_COLORS = [
    "#6C7AE0", "#E06C6C", "#6CE0A1", "#E0C56C",
    "#E08A6C", "#B76CE0", "#6CD4E0", "#E06CB7",
];

export class SpacesManager {
    #spaces     = new Map();
    #activeId   = "default";
    #listeners  = new Set();
    #initialized = false;

    constructor() {
        this.#spaces.set("default", {
            id: "default",
            name: "Personal",
            color: SPACE_COLORS[0],
        });
    }

    async init() {
        if (this.#initialized) return;
        this.#initialized = true;
        await this.#load();
    }

    get activeSpace()  { return this.#spaces.get(this.#activeId); }
    get allSpaces()    { return Array.from(this.#spaces.values()); }
    get activeSpaceId(){ return this.#activeId; }

    async createSpace(name, options = {}) {
        const id    = `space-${Date.now()}`;
        const index = this.#spaces.size;
        const color = options.color || SPACE_COLORS[index % SPACE_COLORS.length];

        this.#spaces.set(id, { id, name, color });
        await this.#save();
        this.#emit("created");
        return this.#spaces.get(id);
    }

    async removeSpace(id) {
        if (id === "default" || !this.#spaces.has(id)) return false;
        this.#spaces.delete(id);
        if (this.#activeId === id) this.#activeId = "default";
        await this.#save();
        this.#emit("removed");
        return true;
    }

    switchTo(id) {
        if (!this.#spaces.has(id)) return;
        this.#activeId = id;
        this.#emit("switched");
    }

    switchToIndex(i) {
        const arr = this.allSpaces;
        if (i >= 0 && i < arr.length) this.switchTo(arr[i].id);
    }

    onChange(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    #emit(event) {
        for (const fn of this.#listeners) {
            try { fn(event); } catch(e) { console.error("[Spaces]", e); }
        }
    }

    async #load() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, "phantom-spaces.json");
            const data = await IOUtils.readJSON(path);
            for (const s of (data.spaces || [])) {
                if (s.id !== "default") this.#spaces.set(s.id, s);
            }
            if (data.activeId && this.#spaces.has(data.activeId)) {
                this.#activeId = data.activeId;
            }
        } catch { /* первый запуск */ }
    }

    async #save() {
        try {
            const path = PathUtils.join(PathUtils.profileDir, "phantom-spaces.json");
            await IOUtils.writeJSON(path, {
                activeId: this.#activeId,
                spaces: this.allSpaces,
            });
        } catch(e) { console.error("[Phantom] save spaces:", e); }
    }
}

export const phantomSpaces = new SpacesManager();
