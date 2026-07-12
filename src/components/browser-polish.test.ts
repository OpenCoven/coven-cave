// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const nativeLifecycle = await readFile(new URL("../lib/native-browser-lifecycle.ts", import.meta.url), "utf8");
const navigationQueue = await readFile(new URL("../lib/browser-navigation-queue.ts", import.meta.url), "utf8");
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
  /function loadRailPinned\(\)[\s\S]*?if \(raw === "0"\) return false;[\s\S]*?return true;\r?\n\}/,
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
  /querySelectorAll\([\s\S]{0,180}\[role="dialog"\][\s\S]{0,180}\[role="menu"\][\s\S]{0,180}\[role="listbox"\]/,
  "visible dialogs, menus, and listboxes count as native-webview covers",
);
assert.match(
  pane,
  /overlay\.getClientRects\(\)\.length > 0/,
  "hidden-but-mounted overlays must not count as cover",
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

// ───────── Native webview lifecycle: deactivate on surface leave ─────────
// Surface transitions hide and retain WebViews. Destroying them here races a
// rapid re-entry against Tauri's asynchronous registry removal and can reuse a
// closing WebView2 as a black, invisible input layer.
assert.match(
  pane,
  /function invokeNativeBrowserDeactivateAll\(bridge: TauriBridge \| null, label: string\): void/,
  "BrowserPane has a direct native-webview deactivation helper",
);
assert.match(
  pane,
  /invokeNativeBrowserDeactivateAll\(bridgeRef\.current, label\);/,
  "unmount cleanup deactivates the pane's native webviews",
);
assert.match(
  nativeLifecycle,
  /__TAURI_INTERNALS__\?: NativeBrowserInternals/,
  "cleanup can call browser_deactivate_all before the async bridge is ready",
);
assert.match(
  pane,
  /active\?: boolean/,
  "BrowserPane accepts an explicit active flag",
);
assert.match(
  pane,
  /if \(active\) return;[\s\S]{0,120}invokeNativeBrowserDeactivateAll\(bridge, label\);/,
  "inactive BrowserPane instances deactivate their native webviews",
);
assert.match(
  pane,
  /if \(!active \|\| !bridge \|\| !nativeBrowserAvailable\)/,
  "bounds sync cannot re-show a native browser layer while inactive",
);
assert.match(
  pane,
  /if \(!active \|\| !bridge \|\| !nativeBrowserAvailable \|\| !activeTab\) return;/,
  "navigation cannot create or re-seat native browser layers while inactive",
);
assert.match(
  workspace,
  /import \{ deactivateAllNativeBrowserWebviews \} from "@\/lib\/native-browser-lifecycle"/,
  "Workspace uses the shared native browser cleanup helper",
);
assert.match(
  workspace,
  /mode === "browser" \|\|[\s\S]{0,180}target\.kind === "browser" \|\| \(target\.kind === "page" && target\.mode === "browser"\)/,
  "Workspace tracks browser visibility across primary and split panes",
);
assert.match(
  workspace,
  /if \(browserVisible\) return;[\s\S]{0,80}deactivateAllNativeBrowserWebviews\(\);/,
  "Workspace deactivates stale native browser webviews when Browser is no longer visible",
);
const deactivateAllFn = rustBrowser.match(
  /pub fn browser_deactivate_all\([\s\S]*?\r?\n\}\r?\n\r?\n\/\/\/ Destroy every native browser WebView/,
)?.[0] ?? "";
assert.match(deactivateAllFn, /schedule_scope_reconcile/, "pane deactivation schedules ordered native reconciliation for every matching WebView");
assert.doesNotMatch(deactivateAllFn, /hide_webview|show_webview_at/, "pane deactivation performs no WebView2 call on the IPC path");
assert.doesNotMatch(deactivateAllFn, /webview\.close\(\)/, "surface deactivation must never destroy a WebView");
assert.match(pane, /bridge\.invoke\("browser_close"[\s\S]{0,160}tabLabel\(id\)/, "explicit tab removal still destroys its WebView");
assert.match(
  rustBrowser,
  /pub fn browser_close_all\([\s\S]{0,500}BrowserScopeAction::Close/,
  "browser_close_all records a close barrier for matching cave-browser webviews",
);
assert.match(rustBrowser, /snapshot\.visibility == BrowserVisibility::Closed[\s\S]{0,500}hide_webview[\s\S]{0,300}webview\.close\(\)/, "ordered worker hides before destroying a closed WebView");

// Rapid enter/leave and overlay transitions can schedule passive cleanup from
// an older render after a newer visibility intent. Every mutation carries a
// monotonic sequence so Rust rejects stale hide/close work.
assert.match(
  nativeLifecycle,
  /Math\.max\([\s\S]{0,100}lastNativeBrowserSequence \+ 1,[\s\S]{0,100}Date\.now\(\) \* 1024/,
  "native browser sequences remain monotonic across rapid commands and renderer reloads",
);
assert.match(pane, /const navigationArgs = withNativeBrowserSequence\([\s\S]{0,500}bridge\.invoke\("browser_navigate", navigationArgs\)/, "browser_navigate includes a lifecycle sequence");
for (const command of ["browser_set_bounds", "browser_hide", "browser_close", "browser_deactivate_all", "browser_reload"]) {
  assert.match(
    pane + nativeLifecycle,
    new RegExp(`${command.replace("_", "_")}[\\s\\S]{0,220}withNativeBrowserSequence|withNativeBrowserSequence[\\s\\S]{0,220}${command}`),
    `${command} includes a lifecycle sequence`,
  );
}
assert.match(
  rustBrowser,
  /struct BrowserLifecycleState\(Arc<Mutex<BrowserLifecycleInner>>\)/,
  "Rust shares ordered native browser lifecycle intent across detached workers",
);
assert.match(
  rustBrowser,
  /pub fn browser_navigate[\s\S]{0,1800}schedule_browser_reconcile\(app, lifecycle, label\);[\s\S]{0,100}Ok\(\(\)\)/,
  "browser navigation accepts and schedules native work without waiting on a slow WebView2 call",
);
assert.match(
  rustBrowser,
  /The lock is never held across a WebView2 call[\s\S]{0,500}pub struct BrowserLifecycleState/,
  "the lifecycle lock cannot deadlock a re-entrant bounds command during child creation",
);
assert.match(
  rustBrowser,
  /struct BrowserLabelIntent[\s\S]{0,500}navigation:[\s\S]{0,300}bounds:[\s\S]{0,300}visibility:/,
  "Rust retains a complete URL, bounds, and visibility intent per native WebView",
);
assert.match(
  rustBrowser,
  /fn command_sequence_is_current[\s\S]{0,800}sequence < barrier\.sequence[\s\S]{0,500}sequence >= intent\.latest_sequence/,
  "Rust rejects stale per-WebView commands",
);
assert.match(
  rustBrowser,
  /fn advance_scope_barrier[\s\S]{0,700}sequence < barrier\.sequence/,
  "Rust rejects stale pane-deactivation and per-webview commands",
);
assert.match(rustBrowser, /worker_locks: HashMap<String, Arc<Mutex<\(\)>>/, "native work is serialized per WebView label");
assert.match(rustBrowser, /worker_signals: HashMap<String, Arc<BrowserWorkerSignal>>/, "duplicate bounds and lifecycle work is coalesced per WebView label");
assert.match(rustBrowser, /for _ in 0\.\.16/, "native workers bound reconciliation churn");
assert.match(rustBrowser, /settled_revision == Some\(snapshot\.revision\)/, "native workers converge to the newest intent revision");
for (const regression of [
  "newest_navigation_wins_even_when_workers_would_finish_out_of_order",
  "navigate_then_hide_keeps_loading_intent_but_never_exposes_input_layer",
  "close_during_creation_cannot_be_resurrected_by_late_bounds",
]) {
  assert.match(rustBrowser, new RegExp(`fn ${regression}`), `${regression} has deterministic reducer coverage`);
}

// ───────── Native webview lifecycle: no 1×1 offscreen parking ─────────
// Shrinking the parked webview to 1×1 lets WKWebView drop its backing layer;
// re-seating it with set_bounds could then render black. hide_webview must
// move it offscreen only, keeping its real size so the layer stays realized.
const hideWebviewFn = rustBrowser.match(
  /fn hide_webview\(webview: &tauri::Webview\) -> Result<\(\), String> \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(hideWebviewFn, "hide_webview() exists in src-tauri/src/browser.rs");
assert.match(hideWebviewFn, /#\[cfg\(target_os = "windows"\)\][\s\S]*webview\.hide\(\)/, "Windows hides WebView2 so it cannot capture clicks");
assert.match(hideWebviewFn, /#\[cfg\(not\(target_os = "windows"\)\)\][\s\S]*set_position\(LogicalPosition::new\(OFFSCREEN_X, OFFSCREEN_Y\)\)/, "non-Windows retains offscreen parking");
assert.match(
  rustBrowser,
  /fn show_webview_at[\s\S]*set_bounds\(Rect \{[\s\S]*position:[\s\S]*size:[\s\S]*#\[cfg\(target_os = "windows"\)\][\s\S]*webview\.show\(\)/,
  "Windows atomically applies clamped bounds before revealing WebView2",
);
assert.match(rustBrowser, /fn browser_bounds_within_client[\s\S]{0,900}!x\.is_finite\(\)[\s\S]{0,500}browser bounds must be finite/, "invalid browser bounds fail closed");
assert.match(rustBrowser, /fn ensure_browser[\s\S]{0,1200}browser_bounds_within_client[\s\S]*main\.add_child/, "first-created WebViews use the same bounded geometry policy");
assert.match(rustBrowser, /fn show_webview_at[\s\S]{0,1200}browser_bounds_within_client[\s\S]*set_bounds/, "existing WebViews use the bounded geometry policy");

// Settings URLs survive the lazy Browser chunk and are cleared only after
// BrowserPane acknowledges the declarative request.
assert.match(navigationQueue, /enqueueBrowserNavigation/, "browser navigation has a durable queue");
assert.match(workspace, /navigationRequest=\{browserNavigationQueue\[0\] \?\? null\}/, "Workspace passes the oldest queued URL declaratively");
assert.match(pane, /bridge\.invoke\("browser_navigate"[\s\S]{0,700}\.then\(\(\) => \{[\s\S]{0,400}acknowledgePendingNavigation\(pending\)/, "desktop navigation acknowledges only after native reconciliation succeeds");
assert.match(pane, /decideBrowserNavigationEvent\([\s\S]{0,100}evUrl,[\s\S]{0,100}expected,/, "native WebView events are checked against the newest requested URL");
assert.match(pane, /phase === "started" \? "started" : "finished"[\s\S]{0,150}!eventDecision\.accept[\s\S]{0,180}eventDecision\.nextExpected/, "stale WebView loads stay guarded through redirects and the newest finished event");
assert.match(navigationQueue, /phase === "started" && expected\.started && !expected\.completed[\s\S]{0,500}chainUrls: \[\.\.\.expected\.chainUrls, actualUrl\]/, "redirect starts remain in the newest navigation generation");
assert.match(navigationQueue, /eventSequence === 0[\s\S]{0,300}eventSequence < expected\.sequence[\s\S]{0,300}eventSequence > expected\.sequence/, "native event generations reject unattributed and older loads before advancing the high-water guard");
assert.match(navigationQueue, /eventSequence > expected\.sequence[\s\S]{0,350}expectationFromAuthoritativeEvent/, "newer user navigation retains a guard against delayed old titles and finishes");
assert.match(rustBrowser, /browser_report_user_navigation[\s\S]{0,600}window\.addEventListener\("click"/, "same-context child clicks are attributed before their native navigation events");
assert.match(workspace, /getItem\(PENDING_IN_APP_BROWSER_URL_KEY\) === request\.url[\s\S]*removeItem/, "session storage clears only after acknowledgement");
assert.doesNotMatch(workspace, /setTimeout\(\(\) => browserPaneRef\.current\?\.navigateTo/, "lazy Browser navigation no longer relies on a one-shot timer/ref");

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
assert.match(pane, /if \(document\.visibilityState !== "visible" \|\| \(!force && now - lastRun < 100\)\) return;/, "the fallback bounds loop is throttled + idle-gated");
assert.match(pane, /forceReconcilePending = true/, "urgent bounds changes are coalesced into the next animation frame");
assert.match(pane, /new ResizeObserver\(scheduleImmediateReconcile\)/, "resizes schedule a coalesced native bounds reconcile");
assert.match(pane, /new MutationObserver\(scheduleImmediateReconcile\)/, "overlay DOM changes schedule a coalesced visibility reconcile");
assert.match(pane, /visibilitychange[\s\S]{0,300}hideAll\(\)/, "backgrounding immediately hides native webviews");

// ───────── a11y: tab strip is a real tablist ─────────
assert.match(pane, /role="tablist" aria-orientation="vertical"/, "tab strip is a tablist");
assert.match(pane, /role="tab"\r?\n\s*tabIndex=\{0\}/, "each tab uses role=tab");
assert.match(pane, /aria-selected=\{isActive\}/, "the active tab is announced via aria-selected");
assert.doesNotMatch(pane, /aria-pressed=\{isActive\}/, "tabs use aria-selected, not aria-pressed");
assert.match(pane, /aria-label=\{`Close tab: \$\{title\}`\}/, "the close button names its tab");
assert.match(pane, /aria-label="Address bar"/, "the address input is labeled");
assert.match(pane, /inert=\{!toolbarOpen \|\| undefined\}/, "the collapsed toolbar is inert (its controls leave the tab order)");
// quick-open palette is a focus-trapped dialog
assert.match(qo, /role="dialog"\r?\n\s*aria-modal="true"/, "quick-open palette is an aria-modal dialog");
assert.match(qo, /useFocusTrap\(true, cardRef, \{ onEscape: onClose/, "quick-open traps focus + restores it on close");

console.log("browser-polish.test.ts: ok");
