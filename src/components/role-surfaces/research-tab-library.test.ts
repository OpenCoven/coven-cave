// Library tab pins (cave-dl74, Phase B3): filter mapping rules, ticker
// realness (no fabricated time-left), view-toggle persistence + SSR guard,
// real-counts header, and the navigation contract. Source-scan style, like
// researcher-surface.test.ts — the tab is a client component with JSX, so
// behavior is pinned against the source rather than imported.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tab = readFileSync(new URL("./research-tab-library.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../../styles/globals/surface-research-library.css", import.meta.url),
  "utf8",
);

// ── Filter mapping (design 277–280) ─────────────────────────────────────────

test("findings filter = published knowledge deliverables only", () => {
  // Kind allowlist covers exactly the five deliverable kinds…
  assert.match(
    tab,
    /FINDINGS_KINDS: ReadonlySet<ResearchArtifactKind> = new Set\(\[\s*"brief",\s*"report",\s*"paper",\s*"findings",\s*"presentation",\s*\]\)/,
  );
  // …and an artifact only counts as findings once it is published.
  assert.match(tab, /FINDINGS_KINDS\.has\(artifact\.kind\) && artifact\.state === "published"/);
});

test("source maps filter = the evidence-shaped kinds", () => {
  assert.match(
    tab,
    /SOURCE_MAP_KINDS: ReadonlySet<ResearchArtifactKind> = new Set\(\[\s*"source-ledger",\s*"research-log",\s*\]\)/,
  );
  assert.match(tab, /SOURCE_MAP_KINDS\.has\(artifact\.kind\)/);
});

test("in progress = working drafts on runs that are not settled — failed runs included", () => {
  // Settled = completed/cancelled/archived; failed is deliberately excluded so
  // a failed run's retryable working draft still shows as in-progress.
  assert.match(
    tab,
    /SETTLED_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set\(\[\s*"completed",\s*"cancelled",\s*"archived",\s*\]\)/,
  );
  assert.match(tab, /artifact\.state === "working" && !SETTLED_STATUSES\.has\(mission\.status\)/);
  // Progress classification wins before the kind buckets (a working
  // source-ledger on a live run reads as in-progress, not a source map).
  const progress = tab.indexOf('!SETTLED_STATUSES.has(mission.status)) return "progress"');
  const maps = tab.indexOf('SOURCE_MAP_KINDS.has(artifact.kind)) return "maps"');
  assert.ok(progress !== -1 && maps !== -1 && progress < maps);
  // Everything else (rejected drafts, leftovers on settled runs) is "other" —
  // visible under All only, never force-fit into a named filter.
  assert.match(tab, /return "other"/);
  assert.match(tab, /if \(entry\.type !== "other"\) tally\[entry\.type\] \+= 1/);
});

test("in-progress cards show a real iteration progress bar, tinted by mission status", () => {
  // Percent derives from the artifact's iteration over the planned max…
  assert.match(tab, /artifact\.iteration \/ Math\.max\(1, mission\.bounds\.maxIterations\)/);
  // …only for progress entries, with an accessible pass label.
  assert.match(tab, /type === "progress"\s*\?\s*Math\.max\(0, Math\.min\(100/);
  assert.match(tab, /aria-label=\{`Pass \$\{artifact\.iteration\} of \$\{mission\.bounds\.maxIterations\}`\}/);
  // Tint is carried by mission status (amber live, red failed) in CSS…
  assert.match(tab, /data-mission-status=\{mission\.status\}/);
  assert.match(css, /\.research-library-card\[data-type="progress"\]\[data-mission-status="failed"\]/);
  assert.match(css, /\.research-library-card\[data-mission-status="failed"\] \.research-library-card__progress i/);
  // …and the kicker words carry it too — never color alone.
  assert.match(tab, /tone: mission\.status === "failed" \? "err" : "warn"/);
  assert.match(tab, /failed: "run failed"/);
});

// ── Live ticker realness (design 264–270) ───────────────────────────────────

test("ticker renders only for live missions, from real phase + pass data", () => {
  assert.match(tab, /new Set\(\[\s*"running",\s*"planning",\s*"queued",\s*\]\)/);
  assert.match(tab, /LIVE_STATUSES\.has\(mission\.status\)/);
  // Current phase comes from the shared reconciler, not a guess.
  assert.match(tab, /researchPhaseStatuses\(mission, PHASE_IDS\)/);
  // Pass count is the mission's own latest iteration; omitted when none exists.
  assert.match(tab, /tickerMission\.iterations\.at\(-1\)\?\.number/);
  assert.match(tab, /pass !== undefined \? `pass \$\{pass\}\/\$\{tickerMission\.bounds\.maxIterations\}` : null/);
  assert.match(tab, /Running now:/);
});

test("ticker time-left is the wall-clock budget reading or nothing — never invented", () => {
  // Derivation goes through researchBoundReadings' time reading…
  assert.match(tab, /researchBoundReadings\(mission\)\.find\(\(reading\) => reading\.id === "time"\)/);
  // …and bails honestly when the reading cannot support it: no started clock,
  // over budget, or an unexpected value shape.
  assert.match(tab, /if \(!mission\.startedAt\) return null/);
  assert.match(tab, /if \(!time \|\| time\.tone === "over"\) return null/);
  assert.match(tab, /\/\^\(\\d\+\)\\\/\(\\d\+\) min\$\/\.exec\(time\.value\)/);
  // The phrase names what it is — budget remaining, not an ETA — and the
  // design's hardcoded "~12 min left" never ships.
  assert.match(tab, /min left in budget/);
  assert.doesNotMatch(tab, /~12 min/);
});

// ── View toggle persistence ─────────────────────────────────────────────────

test("cards/rows toggle persists under cave:research:lib-view with an SSR guard", () => {
  assert.match(tab, /const VIEW_STORAGE_KEY = "cave:research:lib-view"/);
  // Read is SSR-guarded and treats stored garbage as the cards default.
  assert.match(
    tab,
    /function readStoredView\(\): LibraryView \{\s*if \(typeof window === "undefined"\) return "cards"/,
  );
  assert.match(tab, /window\.localStorage\.getItem\(VIEW_STORAGE_KEY\) === "rows" \? "rows" : "cards"/);
  // Writes are guarded too, and only explicit toggles persist.
  assert.match(tab, /window\.localStorage\.setItem\(VIEW_STORAGE_KEY, next\)/);
  assert.match(tab, /setViewState\(next\);\s*if \(typeof window === "undefined"\) return;/);
  // The toggle is stateful buttons, and the rows variant is a CSS mode.
  assert.match(tab, /aria-pressed=\{view === "rows"\}/);
  assert.match(tab, /data-view=\{view\}/);
  assert.match(css, /\.research-library__grid\[data-view="rows"\]/);
});

// ── Real-counts header ──────────────────────────────────────────────────────

test("header counts are real: flattened artifacts from runs that produced them", () => {
  // Entries are the flattening of every mission's artifacts — counts derive
  // from that, not from copy.
  assert.match(tab, /missions\.flatMap\(\(mission\) =>\s*mission\.artifacts\.map/);
  assert.match(tab, /const artifactCount = entries\.length/);
  assert.match(tab, /missions\.filter\(\(mission\) => mission\.artifacts\.length > 0\)\.length/);
  assert.match(tab, /\{artifactCount\} artifact\{artifactCount === 1 \? "" : "s"\} from \{runCount\} run\{runCount === 1 \? "" : "s"\}/);
  assert.match(tab, /Sorted by newest/);
  // Newest-first is enforced, with an invalid-date guard.
  assert.match(tab, /Number\.isFinite\(parsed\) \? parsed : 0/);
  assert.match(tab, /sort\(\(a, b\) => stamp\(b\) - stamp\(a\)\)/);
});

test("card copy is real text only, with relative timestamps that keep ticking", () => {
  // Summary = the producing iteration's summary, else the mission intent.
  assert.match(tab, /\(item\) => item\.number === entry\.artifact\.iteration/);
  assert.match(tab, /iteration\?\.summary\?\.trim\(\) \|\| entry\.mission\.intent/);
  // Meta line: sources · passes · mode (deep loop is the autoresearch label).
  assert.match(tab, /autoresearch: "deep loop"/);
  assert.match(tab, /\$\{sources\} · \$\{passes\} pass\$\{passes === 1 \? "" : "es"\} · \$\{mode\}/);
  // Timestamps reuse the shared relative formatter and advance between polls.
  assert.match(tab, /relativeTime\(artifact\.updatedAt\)/);
  assert.match(tab, /useMinuteTick\(\)/);
  assert.match(css, /\.research-library-card__when \{[^}]*text-transform: none/);
});

// ── Navigation contract + Open behavior ─────────────────────────────────────

test("Watch and View run navigate to the desk with the mission selected", () => {
  assert.match(tab, /onNavigate\("desk", \{ missionId: tickerMission\.id \}\)/);
  assert.match(tab, /onNavigate\("desk", \{ missionId: mission\.id \}\)/);
  assert.match(tab, /Watch →/);
  assert.match(tab, /View run →/);
});

test("Open is the Grimoire jump — offered only when a knowledgeId exists, no fake exports", () => {
  // Same open path as the evidence ledger's artifact cards.
  assert.match(tab, /openGrimoireDoc\("knowledge", artifact\.knowledgeId!\)/);
  assert.match(tab, /\{artifact\.knowledgeId \? \(/);
  // Artifacts expose no client-reachable file export (relativePath is
  // server-side only), so the design's ⤓ md / ⤓ pdf buttons must not ship.
  assert.doesNotMatch(tab, /⤓/);
  assert.doesNotMatch(tab, /pdf/i);
  assert.doesNotMatch(tab, /download/i);
});

test("empty states are honest with a real next step", () => {
  assert.match(tab, /No artifacts yet — finished runs publish here\./);
  assert.match(tab, /onNavigate\("prompt"\)/);
  assert.match(tab, /Start research/);
  // A filtered-out view says so instead of pretending the library is empty.
  assert.match(tab, /Nothing under this filter yet/);
  assert.doesNotMatch(tab, /is being assembled|coming soon/i);
});

test("library offers view/download for unpublished artifacts without publish", () => {
  assert.match(tab, /ResearchArtifactActions/);
  assert.doesNotMatch(tab, /onPublish=/, "library never offers publishing");
});

test("library styles ride the desk container and coven tokens", () => {
  assert.match(css, /@container research-desk \(max-width: 900px\)/);
  assert.match(css, /@container research-desk \(max-width: 560px\)/);
  assert.match(css, /var\(--research-accent\)/);
  assert.match(css, /var\(--destructive\)/);
  // No Nocturne hex literals leak into shipped CSS.
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});
