// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLanguageHighlighterLoader } from "./shiki-language-loader.ts";

const source = readFileSync(new URL("./shiki-highlighter.ts", import.meta.url), "utf8");

assert.match(
  source,
  /langs:\s*\[\]/,
  "the base Shiki singleton starts without eagerly loading the full grammar catalog",
);
assert.doesNotMatch(
  source,
  /langs:\s*\[\.\.\.SHIKI_LANGS\]/,
  "the Shiki singleton must not request every configured grammar on first use",
);
assert.match(
  source,
  /if \(language === "text"\) return loadShikiHighlighter\(\);/,
  "plain text uses Shiki's grammar-free built-in path without a redundant language load",
);

const loaded = new Set<string>();
const loadCalls: string[] = [];
let baseCalls = 0;
let rejectRustOnce = true;
const fakeHighlighter = {
  getLoadedLanguages: () => [...loaded],
  loadLanguage: async (lang: string) => {
    loadCalls.push(lang);
    await Promise.resolve();
    if (lang === "rust" && rejectRustOnce) {
      rejectRustOnce = false;
      throw new Error("synthetic grammar failure");
    }
    loaded.add(lang);
  },
};
const getForLanguage = createLanguageHighlighterLoader(async () => {
  baseCalls += 1;
  return fakeHighlighter;
});

const [first, second] = await Promise.all([
  getForLanguage("typescript"),
  getForLanguage("typescript"),
]);
assert.equal(first, fakeHighlighter, "the loader returns the shared highlighter");
assert.equal(second, fakeHighlighter, "concurrent callers receive the same highlighter");
assert.equal(baseCalls, 2, "the wrapper may consult the memoized base loader per caller");
assert.deepEqual(
  loadCalls,
  ["typescript"],
  "concurrent requests for one language share a single grammar load",
);

await getForLanguage("python");
assert.deepEqual(
  loadCalls,
  ["typescript", "python"],
  "a later language request loads only that additional grammar",
);

await assert.rejects(
  getForLanguage("rust"),
  /synthetic grammar failure/,
  "grammar load errors reach the caller",
);
await getForLanguage("rust");
assert.deepEqual(
  loadCalls,
  ["typescript", "python", "rust", "rust"],
  "a failed grammar request is removed from the in-flight map and can retry",
);

console.log("shiki-highlighter.test.ts: ok");
