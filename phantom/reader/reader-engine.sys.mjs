/**
 * Phantom Reader Engine
 * Извлечение основного контента страницы (Readability-подобный алгоритм)
 */

export class ReaderEngine {
    /**
     * Извлекает основной контент из HTML-документа
     */
    extract(doc) {
        if (!doc || !doc.body) return null;

        const title = this.#extractTitle(doc);
        const content = this.#extractContent(doc);
        const metadata = this.#extractMetadata(doc);

        if (!content || content.length < 100) return null;

        return {
            title,
            content,
            byline: metadata.author,
            siteName: metadata.siteName,
            publishedTime: metadata.publishedTime,
            estimatedReadTime: Math.ceil(content.split(/\s+/).length / 200),
        };
    }

    /**
     * Проверяет, подходит ли страница для режима чтения
     */
    isReaderable(doc) {
        if (!doc || !doc.body) return false;

        const text = doc.body.innerText || "";
        const wordCount = text.split(/\s+/).length;

        // Минимум 200 слов и наличие параграфов
        if (wordCount < 200) return false;

        const paragraphs = doc.querySelectorAll("p");
        let longParagraphs = 0;
        for (const p of paragraphs) {
            if (p.textContent.split(/\s+/).length > 30) longParagraphs++;
        }

        return longParagraphs >= 2;
    }

    // ─── Title extraction ───────────────────────────────

    #extractTitle(doc) {
        // Open Graph title
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        if (ogTitle) return ogTitle.content;

        // Первый h1
        const h1 = doc.querySelector("h1");
        if (h1 && h1.textContent.trim().length > 5) return h1.textContent.trim();

        // document.title без названия сайта
        const title = doc.title || "";
        const cleaned = title.replace(/\s*[\|–—·]\s*.*$/, "").trim();
        return cleaned || title;
    }

    // ─── Content extraction ─────────────────────────────

    #extractContent(doc) {
        // Клонируем, чтобы не мутировать оригинал
        const clone = doc.body.cloneNode(true);

        // Удаляем шум
        const noiseSelectors = [
            "script", "style", "noscript", "iframe", "svg",
            "nav", "header", "footer", "aside",
            ".sidebar", ".widget", ".ad", ".ads", ".adsbygoogle",
            ".social-share", ".share-buttons", ".related-posts",
            ".comments", "#comments", ".comment-section",
            ".popup", ".modal", ".overlay", ".cookie-banner",
            "[role='navigation']", "[role='banner']", "[role='complementary']",
            "[aria-hidden='true']",
        ];

        for (const sel of noiseSelectors) {
            for (const el of clone.querySelectorAll(sel)) {
                el.remove();
            }
        }

        // Ищем основной контент-блок
        const candidates = this.#scoreCandidates(clone);

        if (candidates.length === 0) {
            return clone.innerText || "";
        }

        // Лучший кандидат
        const best = candidates[0].element;

        // Извлекаем чистый HTML
        return this.#cleanContent(best);
    }

    #scoreCandidates(root) {
        const candidates = [];

        // Проверяем article, main, контейнеры с большим текстом
        const articleEl = root.querySelector("article") || root.querySelector("main") || root.querySelector('[role="main"]');
        if (articleEl) {
            candidates.push({ element: articleEl, score: 1000 });
            return candidates;
        }

        // Считаем текст в каждом div/section
        for (const el of root.querySelectorAll("div, section")) {
            const text = el.innerText || "";
            const words = text.split(/\s+/).length;
            const paragraphs = el.querySelectorAll("p").length;
            const links = el.querySelectorAll("a").length;

            // Соотношение текста к ссылкам
            const linkDensity = links > 0 ? words / links : words;

            let score = words * 0.5 + paragraphs * 20 + linkDensity * 2;

            // Бонусы за ID/класс
            const id = (el.id + " " + el.className).toLowerCase();
            if (/article|content|post|entry|text|body|main/.test(id)) score *= 2;
            if (/sidebar|nav|menu|footer|header|comment|ad/.test(id)) score *= 0.1;

            if (score > 50) {
                candidates.push({ element: el, score });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    #cleanContent(element) {
        // Возвращаем HTML с минимальной разметкой
        const allowed = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6",
            "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE",
            "IMG", "FIGURE", "FIGCAPTION", "TABLE", "TR", "TD", "TH",
            "STRONG", "EM", "B", "I", "A", "BR", "HR"]);

        function clean(node) {
            if (node.nodeType === 3) return node.textContent; // text node
            if (node.nodeType !== 1) return "";

            const tag = node.tagName;

            // Пропускаем скрытые
            const style = node.style;
            if (style && (style.display === "none" || style.visibility === "hidden")) {
                return "";
            }

            let children = "";
            for (const child of node.childNodes) {
                children += clean(child);
            }

            if (!children.trim()) return "";

            if (allowed.has(tag)) {
                const attrs = tag === "A" ? ` href="${node.getAttribute("href") || ""}"` :
                              tag === "IMG" ? ` src="${node.getAttribute("src") || ""}" alt="${node.getAttribute("alt") || ""}"` :
                              "";
                return `<${tag.toLowerCase()}${attrs}>${children}</${tag.toLowerCase()}>`;
            }

            return children;
        }

        return clean(element);
    }

    // ─── Metadata ───────────────────────────────────────

    #extractMetadata(doc) {
        const meta = (name) => {
            const el = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
            return el ? el.content : null;
        };

        return {
            author: meta("author") || meta("article:author") || this.#extractAuthorFromPage(doc),
            siteName: meta("og:site_name") || "",
            publishedTime: meta("article:published_time") || meta("date") || "",
        };
    }

    #extractAuthorFromPage(doc) {
        const authorEl = doc.querySelector('[rel="author"], .author, .byline, [itemprop="author"]');
        return authorEl ? authorEl.textContent.trim() : "";
    }
}

export const phantomReader = new ReaderEngine();
