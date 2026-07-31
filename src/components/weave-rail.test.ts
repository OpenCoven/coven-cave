// @ts-nocheck
// Source pins for the weave rail wiring (threads-986.17.3, redesigned in
// cave-f8rdi). The behavior itself is tested in src/lib/weave-rail.test.ts;
// these assertions pin the React layer to the fail-closed contract so a
// refactor cannot quietly reintroduce healthy-by-default rendering.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rail = await readFile(new URL("./weave-rail.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./weaves-view.tsx", import.meta.url), "utf8");
const chrome = await readFile(new URL("./threads-chrome.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/weaves/page.tsx", import.meta.url), "utf8");

// --- rail component ---------------------------------------------------------
assert.match(rail, /export function WeaveRail\(/, "WeaveRail must be exported");
assert.match(rail, /export function StatusPill\(/, "StatusPill is the shared pill primitive");
// pills derive from the view-model, never re-interpret raw data
assert.match(rail, /pillForCoherence\(weave\.coherence\)/, "coherence pill comes from pillForCoherence");
assert.match(view, /pillForCoherence\(paneState\.data\.coherence\)/, "detail pill comes from pillForCoherence");
// every tone in the vocabulary has a class, including the two fail-closed ones
for (const tone of ["holds", "frayed", "snapped", "blocked", "stale", "awaiting", "neutral"]) {
  assert.match(rail, new RegExp(`\\b${tone}: "wv-pill--`), `PILL_CLASS carries the ${tone} tone`);
}
// an all-clear pill goes quiet on a dense row, but only for `holds`
assert.match(rail, /quiet && pill\.tone === "holds"/, "only the holds tone may render quiet");
assert.match(rail, /quiet=\{weaveStatus\(weave\) === "healthy"\}/, "quiet derives from the view-model status");
// trace-to-source affordance on the status pill (OpenTrust trace-detail shape)
assert.match(rail, /onTrace/, "pill exposes a trace callback");
assert.match(rail, /Trace to source/, "trace affordance is labeled");
// evidence-first metadata rendered on the surface
assert.match(rail, /meta\.sourceCursor/, "rail shows the source cursor");
assert.match(rail, /meta\.observedAt/, "rail shows the observation time");
// referent-bound vocabulary: weave counts threads, never conversations
assert.match(rail, /thread\{weave\.threadCount === 1 \? "" : "s"\}/, "rail counts threads");
assert.match(rail, /read-only until repair/, "degraded surfaces render the read-only rule");
assert.match(rail, /ward unreadable — protection not verifiable/, "R12 degraded familiar row renders exact blocked copy");
assert.match(rail, /visibleDegraded\.map/, "R12 degraded rows render separately from healthy weaves");
assert.match(
  rail,
  /key=\{`degraded:\$\{entry\.familiarId\}:\$\{entry\.reason\}`\}/,
  "R12 degraded rows have stable keys across reasons for one familiar",
);
const degradedRowsSource = rail.slice(rail.indexOf("{visibleDegraded.map"));
assert.doesNotMatch(degradedRowsSource, /onSelect/, "R12 degraded rows do not expose selection/action affordances");
assert.match(degradedRowsSource, /withheld rather than listed as an empty set/, "R12 rows say why nothing is listed");
// scoping: search + familiar + operator status, all through the view-model
assert.match(rail, /matchesScope\(weave, scope\)/, "rail scopes weaves through the view-model");
assert.match(rail, /sortWeavesWorstFirst\(weaves\)/, "rail orders worst-first");
assert.match(rail, /showStatusFilter \?/, "a one-bucket status filter is not rendered");
assert.match(rail, /filtered empty, not a blocked read/, "a scoped-out list distinguishes itself from blocked");

// --- composing view ---------------------------------------------------------
assert.match(view, /surfaceStateFromPayload/, "view derives render state via the view-model, not ad hoc");
assert.match(view, /BlockedSurface/, "view has a full blocked-surface treatment");
assert.match(chrome, /export function BlockedSurface\(/, "the blocked treatment is shared chrome");
assert.match(view, /Blocked — cannot verify/, "blocked surface says cannot-verify, calmly");
assert.match(view, /never healthy/, "view states the fail-closed rendering rule");
assert.match(view, /cache: "no-store"/, "reads are never cached — freshness is the contract");
// fetch failure itself fails closed
assert.match(view, /daemon-unreachable/, "fetch failure maps to a blocked state");
// banners render for ready states (fixture-data + stale)
assert.match(view, /SurfaceBanners banners=\{railState\.banners\}/, "banner strip present");
assert.match(view, /TraceDrawer/, "trace drawer renders pill evidence");
assert.match(view, /traceForWeave|traceForTension|traceForDegradedFamiliar/, "traces come from the view-model");
// summary + tallies are derived, never counted inline
assert.match(view, /weaveSummaryLine\(paneState\.data\)/, "the detail verdict comes from the view-model");
assert.match(view, /weaveTallies\(entries, pendingCount \?\? 0\)/, "the overview counts come from the view-model");
// a blocked proposals read must not make a thread claim a decision is pending
assert.match(view, /if \(proposalsState\.kind !== "ready"\) return map/, "staged threads need a verified queue");
assert.match(view, /pendingCount =\s*\n?\s*proposalsState\.kind === "ready"/, "the pending badge needs a verified queue");
// empty selection guidance keeps the referent binding
assert.match(view, /binds one protected surface to one\s+writer/, "thread referent stated in empty state");

// --- header chrome -----------------------------------------------------------
assert.match(chrome, /export function ThreadsHeader\(/, "both surfaces share one header");
assert.match(chrome, /href=\{MEMORIES_HREF\}/, "Weaves breadcrumbs back to Memories");
assert.match(chrome, /MEMORIES_HREF = "\/\?mode=grimoire"/, "the Memories parent path is the grimoire mode");
assert.match(chrome, /href="\/proposals"/, "Weaves exposes the nested proposal decision queue");
assert.match(chrome, /pendingCount !== null && pendingCount > 0/, "the badge is omitted when the queue is unverifiable");

// --- page shell --------------------------------------------------------------
assert.match(page, /AnalyticsPageShell/, "page mounts the standalone shell");
assert.match(page, /<WeavesView \/>/, "the surface owns its own chrome");
assert.match(page, /never healthy/, "page states the fail-closed rendering rule");

console.log("weave-rail wiring: all assertions passed");
