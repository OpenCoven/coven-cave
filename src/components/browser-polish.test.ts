// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const rustBrowser = await readFile(new URL("../../src-tauri/src/browser.rs", import.meta.url), "utf8");

// ───────── Task 1: Keyboard hint footer + [ shortcut ─────────
assert.match(
  pane,
  /⌘K tabs · ⌘\[ back · ⌘\] forward · ⌘R reload · \[ pin rail/,
  "Footer hint string must list the keyboard shortcuts",
);
assert.match(
  pane,
  /if \(e\.key !== "\["\) return;/,
  "[ keyboard handler must filter on e.key === '['",
);
assert.match(
  pane,
  /setRailPinned\(\(v\) => !v\)/,
  "[ handler must call setRailPinned((v) => !v)",
);

// ───────── Rail opens pinned by default (persisted) ─────────
// The tab rail should start open so its tabs are visible on first open, and
// remember an explicit auto-hide choice across sessions — without ever
// covering the top menu bar (it stays inside .browser-pane, below .shell-top).
assert.match(
  pane,
  /useState\(loadRailPinned\)/,
  "railPinned must initialize from the persisted loadRailPinned() helper",
);
assert.match(
  pane,
  /function loadRailPinned\(\)[\s\S]*?if \(raw === "0"\) return false;[\s\S]*?return true;\n\}/,
  "loadRailPinned() must default to true (rail open) when no preference is stored",
);
assert.match(
  pane,
  /useEffect\(\(\) => \{\s*saveRailPinned\(railPinned\);\s*\}, \[railPinned\]\)/,
  "railPinned changes must be persisted via saveRailPinned",
);
assert.match(
  pane,
  /paneRef\.current\?\.contains\(e\.target as Node\)/,
  "[ handler must be scoped to focus inside the pane",
);

// ───────── Task 2: Tab label legibility ─────────
assert.match(
  pane,
  /\{railExpanded \? \(\s*<span className="w-\[44px\] truncate text-center text-\[10px\] leading-tight">\{title\}<\/span>\s*\) : null\}/,
  "Tab label gated on railExpanded + text-[10px]",
);
assert.doesNotMatch(
  pane,
  /<span className="w-\[44px\] truncate text-center text-\[9px\] leading-tight">/,
  "Old text-[9px] label must be removed",
);

// ───────── Task 3: Wider rail, no collapsed numeric badge ─────────
assert.match(pane, /w-3\.5 hover:w-12 focus-within:w-12/, "Collapsed rail width must be w-3.5");
assert.doesNotMatch(pane, /w-1\.5 hover:w-12 focus-within:w-12/, "Old w-1.5 width must be removed");
assert.match(pane, /minWidth: railExpanded \? 48 : 14/, "minWidth must be 14 when collapsed");
assert.doesNotMatch(
  pane,
  /!railExpanded \? \(\s*<span[\s\S]*?>\s*\{tabs\.length\}\s*<\/span>\s*\) : null/,
  "Collapsed browser rail must not render a numeric tab-count badge",
);
assert.doesNotMatch(
  pane,
  /w-\[2px\] rounded-r-full bg-\[var\(--fg-base\)\]\/20/,
  "Old 2px accent dot must be removed",
);

// ───────── Mobile browser chrome ─────────
assert.match(pane, /browser-toolbar/, "Browser toolbar should expose a stable mobile chrome hook");
assert.match(pane, /browser-toolbar-button/, "Browser toolbar buttons should expose a mobile hook");
assert.match(pane, /browser-address-form/, "Browser address form should expose a mobile hook");
assert.match(pane, /browser-address-input/, "Browser address input should expose a mobile hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-tab-rail\s*\{[\s\S]*display:\s*none/,
  "Mobile browser should hide the hover rail instead of exposing tiny offscreen controls",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-toolbar\s*\{[\s\S]*transform:\s*none !important[\s\S]*pointer-events:\s*auto !important/,
  "Mobile browser toolbar should stay visible without relying on hover or keyboard shortcuts",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-toolbar-button\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile browser toolbar buttons should meet the shared touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-address-input\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile browser address input should meet the shared touch target",
);

// ───────── Native webview yields to DOM overlays ─────────
// The embedded browser webview is an OS-level layer above the whole DOM, so
// the pane must hide it whenever an overlay renders (onboarding covered by a
// stuck white webview was the reported bug).
assert.match(
  pane,
  /function surfaceIsCovered\(surface: HTMLElement, rect: DOMRect\): boolean/,
  "pane has an occlusion detector for the native overlay",
);
assert.match(
  pane,
  /querySelectorAll\('\[role="dialog"\], \[aria-modal="true"\]'\)/,
  "any visible dialog (Modal, onboarding, palette, quick chat) counts as cover",
);
assert.match(
  pane,
  /dialog\.getClientRects\(\)\.length > 0/,
  "hidden-but-mounted dialogs must not count as cover",
);
assert.match(
  pane,
  /document\.elementFromPoint\(x, y\)/,
  "the pane rect is point-sampled for non-dialog overlays",
);
assert.match(
  pane,
  /closest\('\[role="status"\], \[role="alert"\], \[aria-live\]'\)/,
  "transient live regions (toasts) don't blank the page",
);
assert.match(
  pane,
  /toolbarOpenRef\.current \|\|\s*\n\s*rect\.width <= 1 \|\|\s*\n\s*rect\.height <= 1 \|\|\s*\n\s*surfaceIsCovered\(surface, rect\)/,
  "the bounds loop hides all webviews while the pane is covered",
);
// browser_navigate repositions/creates the webview at the given bounds, and
// the bounds loop only issues IPC on transitions — navigating while covered
// must therefore target the offscreen position or the webview reappears over
// the overlay and never re-hides (the onboarding screenshot bug).
assert.match(
  pane,
  /const WEBVIEW_OFFSCREEN = -10000;/,
  "offscreen constant mirrors OFFSCREEN_X/Y in src-tauri/src/browser.rs",
);
assert.match(
  pane,
  /const covered = toolbarOpenRef\.current \|\| surfaceIsCovered\(surface, rect\);[\s\S]{0,320}x: covered \? WEBVIEW_OFFSCREEN : rect\.left,\s*\n\s*y: covered \? WEBVIEW_OFFSCREEN : rect\.top,/,
  "navigate loads covered webviews offscreen; the bounds loop re-seats them when the cover lifts",
);

// ───────── Native webview lifecycle: close on surface leave ─────────
// Hiding only parks a webview offscreen — the page stays alive and its
// content lingers in the OS accessibility tree after leaving the Browser
// surface. Unmount must CLOSE the pane's webviews, not hide them.
assert.match(
  pane,
  /useEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*void bridgeRef\.current\?\.invoke\("browser_close_all", \{ label \}\);/,
  "unmount cleanup closes the pane's native webviews (browser_close_all), not just hides them",
);
assert.match(
  rustBrowser,
  /pub fn browser_close_all\(app: AppHandle, label: Option<String>\)[\s\S]{0,600}webview\.close\(\)/,
  "browser_close_all destroys matching cave-browser webviews",
);

// ───────── Native webview lifecycle: no 1×1 offscreen parking ─────────
// Shrinking the parked webview to 1×1 lets WKWebView drop its backing layer;
// re-seating it with set_bounds could then render black. hide_webview must
// move it offscreen only, keeping its real size so the layer stays realized.
const hideWebviewFn = rustBrowser.match(
  /fn hide_webview\(webview: &tauri::Webview\) -> Result<\(\), String> \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(hideWebviewFn, "hide_webview() exists in src-tauri/src/browser.rs");
assert.match(hideWebviewFn, /set_position\(LogicalPosition::new\(OFFSCREEN_X, OFFSCREEN_Y\)\)/, "hide_webview parks the webview offscreen");
assert.doesNotMatch(hideWebviewFn, /set_size/, "hide_webview must not resize the parked webview (1×1 parking caused black re-paints)");

// ───────── Task 4: Quick-open backdrop ─────────
const qo = await readFile(new URL("./browser-quick-open.tsx", import.meta.url), "utf8");
assert.match(qo, /bg-black\/40 backdrop-blur-sm/, "Backdrop must use bg-black/40 + backdrop-blur-sm");
assert.match(qo, /onClick=\{onClose\}/, "Outer container must handle onClick={onClose}");
assert.match(qo, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "Inner card must stopPropagation on click");

// ───────── Security: iframe fallback sandbox ─────────
// allow-top-navigation lets framed arbitrary content navigate the whole app
// window away — it must never be in the fallback sandbox.
assert.doesNotMatch(pane, /allow-top-navigation/, "iframe sandbox must not grant allow-top-navigation");
assert.match(pane, /sandbox="allow-same-origin allow-scripts allow-forms allow-popups"/, "iframe fallback keeps a scoped sandbox");

// ───────── Correctness: back/forward preserves forward history ─────────
// A back/forward re-navigation lands on the URL already at the current index;
// the page-load handler must skip the truncate-and-append that would destroy
// the forward entries.
assert.match(pane, /if \(h\.stack\[h\.idx\] === evUrl\) \{/, "page-load history push guards against clobbering forward entries");

// ───────── Correctness: listen() unlisten race + perf throttle ─────────
assert.match(pane, /then\(\(fn\) => \{ if \(cancelled\) fn\(\); else unlisten/, "async listen() unlistens if the effect was already torn down");
assert.match(pane, /if \(document\.visibilityState !== "visible" \|\| now - lastRun < 100\) return;/, "the bounds-reconcile rAF loop is throttled + idle-gated");

// ───────── a11y: tab strip is a real tablist ─────────
assert.match(pane, /role="tablist" aria-orientation="vertical"/, "tab strip is a tablist");
assert.match(pane, /role="tab"\n\s*tabIndex=\{0\}/, "each tab uses role=tab");
assert.match(pane, /aria-selected=\{isActive\}/, "the active tab is announced via aria-selected");
assert.doesNotMatch(pane, /aria-pressed=\{isActive\}/, "tabs use aria-selected, not aria-pressed");
assert.match(pane, /aria-label=\{`Close tab: \$\{title\}`\}/, "the close button names its tab");
assert.match(pane, /aria-label="Address bar"/, "the address input is labeled");
assert.match(pane, /inert=\{!toolbarOpen \|\| undefined\}/, "the collapsed toolbar is inert (its controls leave the tab order)");
// quick-open palette is a focus-trapped dialog
assert.match(qo, /role="dialog"\n\s*aria-modal="true"/, "quick-open palette is an aria-modal dialog");
assert.match(qo, /useFocusTrap\(true, cardRef, \{ onEscape: onClose/, "quick-open traps focus + restores it on close");

console.log("browser-polish.test.ts: ok");
