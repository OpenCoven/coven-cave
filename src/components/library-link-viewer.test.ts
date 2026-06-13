// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const preview = await readFile(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./library-view.tsx", import.meta.url), "utf8");
const browser = await readFile(new URL("../../src-tauri/src/browser.rs", import.meta.url), "utf8");

assert.match(
  preview,
  /function LibraryLinkViewer\(/,
  "Library preview should have a dedicated embedded link viewer",
);

assert.match(
  preview,
  /import \{ useTauriPlatform \} from "@\/lib\/tauri-platform"/,
  "Library link viewer should inspect the Tauri platform before using native browser IPC",
);

assert.match(
  preview,
  /const platform = useTauriPlatform\(\);[\s\S]{0,120}const nativeBrowserAvailable = platform === "desktop";/,
  "Library link viewer should only treat desktop Tauri as native-browser capable",
);

assert.match(
  preview,
  /if \(platform === "unknown"\) return;[\s\S]{0,160}if \(!nativeBrowserAvailable\) \{[\s\S]{0,120}setBridge\(null\);[\s\S]{0,120}setUnavailable\(true\);[\s\S]{0,120}return;/,
  "Library link viewer should fall back instead of calling browser_* commands on Tauri mobile",
);

assert.match(
  preview,
  /browser_navigate[\s\S]*readOnlyUrl:\s*url/,
  "Embedded Library link viewer should ask the native webview to stay read-only",
);

assert.match(
  preview,
  /browser:scroll[\s\S]*setHeaderCollapsed\(scrollY > 24\)/,
  "Embedded Library link viewer header should collapse from native webview scroll events",
);

assert.match(
  preview,
  /library-link-viewer--header-collapsed/,
  "Embedded Library link viewer should expose a collapsed header class",
);

assert.match(
  preview,
  /<iframe[\s\S]*className="library-link-viewer-frame"[\s\S]*sandbox="allow-same-origin allow-scripts allow-forms"/,
  "Browser fallback should use a sandboxed iframe without top-navigation permission",
);

assert.doesNotMatch(
  preview,
  /library-link-viewer-frame[\s\S]{0,300}allow-top-navigation/,
  "Library link viewer iframe must not allow top-level navigation",
);

assert.match(
  preview,
  /function BookmarkDetail[\s\S]*<LibraryLinkViewer/,
  "Bookmark selections should render the embedded Library link viewer",
);

assert.match(
  preview,
  /function ReadingDetail[\s\S]*if \(item\.url\)[\s\S]*<LibraryLinkViewer/,
  "Reading URL selections should render the embedded Library link viewer",
);

assert.match(
  preview,
  /function GitHubDetail[\s\S]*<LibraryLinkViewer/,
  "GitHub selections should render the embedded Library link viewer",
);

assert.doesNotMatch(
  view,
  /if \(onOpenUrl && item\.url\) \{ onOpenUrl\(item\.url\); return; \}/,
  "Library list selections should stay in Library instead of switching to full Browser mode",
);

assert.match(
  browser,
  /read_only_url:\s*Option<String>/,
  "Native browser command should accept an optional read-only URL",
);

assert.match(
  browser,
  /\.on_navigation\(move \|next_url\|/,
  "Native child webview should install a navigation guard",
);

assert.match(
  browser,
  /browser:scroll/,
  "Native child webview should emit scroll events for the Library viewer chrome",
);

assert.match(
  browser,
  /pub fn browser_report_scroll/,
  "Native child webview should expose a scroll reporting command",
);

console.log("library-link-viewer.test.ts: ok");
