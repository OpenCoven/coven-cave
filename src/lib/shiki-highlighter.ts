// ---------------------------------------------------------------------------
// shiki-highlighter — the app-wide lazy Shiki singleton
// ---------------------------------------------------------------------------
//
// One highlighter instance (theme + on-demand grammars) shared
// by every surface that colors code: chat code fences (message-bubble.tsx)
// and the GitHub review-thread diff renderer (gh-diff-view.tsx). Shiki + its
// WASM engine are heavy, so the import is dynamic and the instance is created
// once, on first use, client-side only.

import type { Highlighter } from "shiki";
import moodCTheme from "@/styles/shiki/mood-c-dark.json";
import type { ShikiLang } from "@/lib/code-lang";
import { createLanguageHighlighterLoader } from "@/lib/shiki-language-loader";

let highlighterPromise: Promise<Highlighter> | null = null;

function loadShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        // Shiki normalizes themes IN PLACE (e.g. prepends a scope-less global
        // tokenColors entry). The JSON import is a shared module singleton —
        // code-editor-theme.ts reads the same object — so hand Shiki a clone,
        // never the module instance (cave-h1hi).
        themes: [structuredClone(moodCTheme) as Parameters<typeof createHighlighter>[0]["themes"][number]],
        // Loading the complete language catalog here made the first Chat code
        // fence request 41 grammar chunks before any formatted prose painted.
        // The wrapper below adds only the resolved grammar a caller needs.
        langs: [],
      });
    })();
  }
  return highlighterPromise;
}

const loadForLanguage = createLanguageHighlighterLoader<ShikiLang, Highlighter>(
  loadShikiHighlighter,
);

export function getShikiHighlighter(language: ShikiLang): Promise<Highlighter> {
  // Shiki treats `text` as a grammar-free built-in and intentionally omits it
  // from getLoadedLanguages(), so routing it through the loader would repeat a
  // no-op load for every unknown/plain fence.
  if (language === "text") return loadShikiHighlighter();
  return loadForLanguage(language);
}
