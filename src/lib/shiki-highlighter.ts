// ---------------------------------------------------------------------------
// shiki-highlighter — the app-wide lazy Shiki singleton
// ---------------------------------------------------------------------------
//
// One highlighter instance (theme + full grammar set from SHIKI_LANGS) shared
// by every surface that colors code: chat code fences (message-bubble.tsx)
// and the GitHub review-thread diff renderer (gh-diff-view.tsx). Shiki + its
// WASM engine are heavy, so the import is dynamic and the instance is created
// once, on first use, client-side only.

import type { Highlighter } from "shiki";
import moodCTheme from "@/styles/shiki/mood-c-dark.json";
import { SHIKI_LANGS } from "@/lib/code-lang";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        // Shiki normalizes themes IN PLACE (e.g. prepends a scope-less global
        // tokenColors entry). The JSON import is a shared module singleton —
        // code-editor-theme.ts reads the same object — so hand Shiki a clone,
        // never the module instance (cave-h1hi).
        themes: [structuredClone(moodCTheme) as Parameters<typeof createHighlighter>[0]["themes"][number]],
        langs: [...SHIKI_LANGS],
      });
    })();
  }
  return highlighterPromise;
}
