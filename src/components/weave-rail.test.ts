// @ts-nocheck
// Source pins for the weave rail wiring (threads-986.17.3). The behavior
// itself is tested in src/lib/weave-rail.test.ts; these assertions pin the
// React layer to the fail-closed contract so a refactor cannot quietly
// reintroduce healthy-by-default rendering.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rail = await readFile(new URL("./weave-rail.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./weaves-view.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/weaves/page.tsx", import.meta.url), "utf8");

// --- rail component ---------------------------------------------------------
assert.match(rail, /export function WeaveRail\(/, "WeaveRail must be exported");
assert.match(rail, /export function StatusPill\(/, "StatusPill is the shared pill primitive");
// pills derive from the view-model, never re-interpret raw data
assert.match(rail, /pillForTension\(weave\.tensionRollup\)/, "rollup pill comes from pillForTension");
assert.match(rail, /pillForCoherence\(weave\.coherence\)/, "coherence pill comes from pillForCoherence");
// blocked tone exists and is visually distinct from holds
assert.match(rail, /blocked:/, "PILL_CLASSES carries a blocked tone");
assert.match(rail, /stale:/, "PILL_CLASSES carries a stale tone");
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
const degradedRowsSource = rail.slice(rail.indexOf("{visibleDegraded.map"));
assert.doesNotMatch(degradedRowsSource, /onSelect/, "R12 degraded rows do not expose selection/action affordances");
// familiar filter
assert.match(rail, /familiarFilter/, "rail filters by familiar");

// --- composing view ---------------------------------------------------------
assert.match(view, /surfaceStateFromPayload/, "view derives render state via the view-model, not ad hoc");
assert.match(view, /BlockedSurface/, "view has a full blocked-surface treatment");
assert.match(view, /Blocked — cannot verify/, "blocked surface says cannot-verify, calmly");
assert.match(view, /cache: "no-store"/, "reads are never cached — freshness is the contract");
// fetch failure itself fails closed
assert.match(view, /daemon-unreachable/, "fetch failure maps to a blocked state");
// banners render for ready states (fixture-data + stale)
assert.match(view, /Banners/, "banner strip present");
assert.match(view, /TraceDrawer/, "trace drawer renders pill evidence");
assert.match(view, /traceForWeave|traceForTension|traceForDegradedFamiliar/, "traces come from the view-model");
// empty selection guidance keeps the referent binding
assert.match(view, /binds one protected surface to one\s+writer/, "thread referent stated in empty state");

// --- page shell --------------------------------------------------------------
assert.match(page, /dr-page/, "page uses the standard shell");
assert.match(page, /Weaves<\/span>/, "breadcrumb names the surface");
assert.match(page, /never healthy/, "page states the fail-closed rendering rule");

console.log("weave-rail wiring: all assertions passed");
