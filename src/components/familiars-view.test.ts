import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = [
  readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./familiars-view-sections.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../lib/surface-warmup-registry.ts", import.meta.url), "utf8"),
].join("\n");
const memoryRequestGate = readFileSync(
  new URL("../lib/memory-feed-request-gate.ts", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarsView/, "FamiliarsView must be exported");

assert.match(
  source,
  /useResolvedFamiliars\(familiars, \{ includeArchived: true \}\)/,
  "FamiliarsView should resolve local avatar images before rendering roster/detail surfaces",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{familiar\} size="lg" \/>/,
  "FamiliarsView roster card should render FamiliarAvatar instead of raw daemon icons",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{f\} size="sm" \/>/,
  "FamiliarsView rail should render uploaded avatar images via FamiliarAvatar",
);

assert.match(
  source,
  /useSurfacePreference\(surfacePreferenceSpecs\.familiars\.selectedId\)/,
  "Selection persistence uses the shared workspace preference registry",
);

assert.match(
  source,
  /useSurfacePreference\(surfacePreferenceSpecs\.familiars\.viewMode\)/,
  "The roster/detail preference is restored through the same registry",
);

assert.match(
  source,
  /readSurfaceResource<FileMemoryResponse>\(\s*"memory:list",\s*false,\s*\)/,
  "file-memory landing data consumes the shared warm cache",
);
assert.doesNotMatch(
  source,
  /agents:coven-memory/,
  "the retired generic Coven-memory warmup key must not remain in the view or registry",
);

assert.match(
  source,
  /usePausablePoll\(\(\) => void loadMemory\(\), 30_000\)/,
  "background file-memory polls stay non-forced and coalesced",
);

// (cave-5dnw) FamiliarsView's poll is the ONLY memory poll while the studio is
// open: the embedded FamiliarsMemoryView mounts consume the parent's data via
// the memoryFeed prop instead of running a duplicate file fetch+poll.
assert.match(
  source,
  /const memoryFeed = useMemo<MemoryFeed>\(/,
  "FamiliarsView builds a single memoized memory feed",
);
// Refresh coordinated two feeds and returned the canonical result. One feed
// remains, so it returns nothing — but the ownership discipline is the part
// that mattered and is unchanged: a forced refresh takes the gate, publishes
// only while current, and releases it in a finally.
assert.match(
  source,
  /const refreshMemory = useCallback\(async \(\): Promise<void> => \{[\s\S]*const request = requestGate\.beginForce\(\);[\s\S]*readSurfaceResource<FileMemoryResponse>\(\s*"memory:list",\s*true,[\s\S]*requestGate\.isCurrent\(request\)[\s\S]*requestGate\.finishForce\(request\)/,
  "explicit Memory Refresh is publication-gated and always releases the force token",
);
assert.match(
  memoryRequestGate,
  /finishForce\(request: ForcedMemoryFeedRequest\)[\s\S]*activeForceEpoch === request\.forceEpoch[\s\S]*activeForceEpoch = null/,
  "only the current forced token can release background publication",
);
assert.match(
  source,
  /createMemoryFeedRequestGate\(\)[\s\S]*requestGate\.mount\(\);[\s\S]*requestGate\.unmount\(\)/,
  "the production parent mounts and invalidates the tested ownership gate",
);
assert.match(
  source,
  /beginBackground\("files"\)/,
  "the parent background poll enters its own request domain",
);
assert.ok(
  (source.match(/requestGate\.isCurrent\(request\)/g) ?? []).length >= 2,
  "every async parent feed outcome is publication-gated",
);
assert.doesNotMatch(
  source,
  /await refreshCanonicalMemory\(\);\s*await loadCanonicalMemory\(\)/,
  "Familiars must not discard a successful forced list because overview failed",
);
assert.match(
  source,
  /reload: refreshMemory,/,
  "embedded memory refreshes use the coordinated explicit refresh",
);
assert.ok(
  (source.match(/onClick=\{\(\) => void refreshMemory\(\)\}/g) ?? []).length >= 2,
  "both visible roster Refresh actions use the coordinated explicit refresh",
);
assert.ok(
  (source.match(/feed=\{memoryFeed\}/g) ?? []).length >= 2,
  "both embedded FamiliarsMemoryView mounts (overlay + detail tab) receive the feed",
);
{
  const memView = readFileSync(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");
  // The vault reader is gone from this view; only the file path model remains,
  // which is why the pending-delete filter below is path-based at all.
  assert.doesNotMatch(
    memView,
    /CanonicalMemoryReader|CanonicalMemorySummary|feed\.canonical/,
    "the retired vault reader and its feed are gone from the memory view",
  );
  assert.match(
    memView,
    /feed\.files\.entries\.filter\(\s*\(entry\) => entry\.fullPath !== pendingDelete,\s*\)/,
    "the feed mirror filters the pending-delete path for file entries",
  );
}

assert.match(
  source,
  /buildFamiliarCardStats\(\{[\s\S]*familiars,[\s\S]*sessions,[\s\S]*fileEntries[\s\S]*\}\)/,
  "Per-card stats are derived from buildFamiliarCardStats",
);
assert.match(
  source,
  /memoryAvailability:\s*fileMemoryState\.state === "ready"/,
  "file-scan availability is threaded into familiar card stats",
);
assert.match(
  source,
  /stats\.memoryAvailability === "ready"\s*\?\s*compactCount\(stats\.memoryCount\)\s*:\s*"—"/,
  "the roster never presents an unavailable count as zero",
);
assert.match(
  source,
  /const renownAvailable = stats\.memoryAvailability === "ready"/,
  "roster renown presentation checks memory availability",
);
assert.match(
  source,
  /renownAvailable \? renown\.tier\.label : "—"/,
  "the roster does not present a fallback-derived tier as confirmed renown",
);
assert.match(
  source,
  /renownAvailable\s*\?\s*renown\.next[\s\S]*:\s*"Renown unavailable"/,
  "the roster does not expose a fallback-derived renown score in its tooltip",
);

// cave-mo4q: roster cards derive the growth healthLabel from the SAME stats
// the card renders (retro state is the dashboard's — null here) and pass it
// to the card as the status-dot + word pattern.
assert.match(
  source,
  /const healthByFamiliar = useMemo\(\(\) => \{[\s\S]*deriveGrowthReport\(\{ familiar, stats: cardStats, retroState: null \}\)\.healthLabel,[\s\S]*\}, \[familiars, stats\]\);/,
  "Roster health labels derive from deriveGrowthReport over the rendered stats",
);
assert.match(
  source,
  /healthLabel=\{healthByFamiliar\.get\(familiar\.id\) \?\? "steady"\}/,
  "Each roster card receives its derived health label",
);

// cave-mo4q: the Enhancement Rite's "open daily notes" hint lands on the
// familiar's Daily Notes tab — same preference registry the panel reads.
assert.match(
  source,
  /const \[, setDetailTab\] = useSurfacePreference\(surfacePreferenceSpecs\.familiars\.detailTab\);/,
  "FamiliarsView shares the detail-tab preference registry with the detail panel",
);
assert.match(
  source,
  /const openDailyNotes = useCallback\(\(id: string\) => \{[\s\S]*setEnhanceTarget\(null\);\s*setSelectedFamiliarId\(id\);\s*setViewMode\("detail"\);\s*setDetailTab\("daily-notes"\);/,
  "Open daily notes closes the rite and opens the familiar's Daily Notes tab",
);
assert.match(
  source,
  /onOpenDailyNotes=\{openDailyNotes\}/,
  "The summoning circle receives the daily-notes wiring",
);
assert.match(
  source,
  /memoryCount=\{[\s\S]*stats\.get\(enhanceTarget\.id\)\?\.memoryAvailability === "ready"[\s\S]*memoryCount \?\? null/,
  "The rite learns the known memory count (null when memory is unavailable)",
);

assert.match(
  source,
  /viewMode === "detail" && selectedFamiliar/,
  "Detail layout renders when viewMode is detail and a familiar is selected",
);

assert.match(
  source,
  /<FamiliarDetailRail[\s\S]*<FamiliarDetailPanel/,
  "Detail layout mounts the rail + panel",
);

// The pending-navigation branch existed so a deep link to one vault memory
// could hold the scope on its exact target. With the vault gone there is no
// deep link, and the ordinary fallback is the whole rule.
assert.match(
  source,
  /const memoryFamiliar = selectedFamiliar \?\? resolvedActiveFamiliar \?\? null/,
  "memory scope falls back to the selected then the active familiar",
);

assert.match(
  source,
  /<FamiliarMemoryOverlay[\s\S]*familiar=\{memoryFamiliar\}/,
  "Familiar memory overlay is scoped to the selected familiar",
);

assert.match(
  source,
  /const \[previewFamiliar, setPreviewFamiliar\] = useState<ResolvedFamiliar \| null>\(null\)/,
  "FamiliarsView tracks the familiar selected for avatar preview",
);

assert.match(
  source,
  /onPreview=\{setPreviewFamiliar\}/,
  "Detail rail can open the enlarged avatar preview",
);

assert.match(
  source,
  /onClick=\{\(\) => \{\s*onSelect\(f\.id\);\s*onPreview\(f\);/,
  "Selecting a rail avatar opens the preview for that familiar",
);

assert.match(
  source,
  /aria-label=\{`Preview \$\{f\.display_name\}'s avatar`\}/,
  "Rail avatar buttons expose preview intent to assistive tech",
);

assert.match(
  source,
  /aria-label=\{`Enlarge \$\{familiar\.display_name\}'s avatar`\}/,
  "Detail header avatar exposes an enlarge action",
);

assert.match(
  source,
  /<FamiliarAvatarPreviewOverlay[\s\S]*familiar=\{previewFamiliar\}/,
  "Avatar preview overlay renders for the selected preview familiar",
);

assert.match(
  source,
  /<Modal[\s\S]*ariaLabel=\{`\$\{familiar\.display_name\} avatar preview`\}/,
  "Avatar preview uses the shared modal with an accessible label",
);

assert.match(
  source,
  /<AuthedImage[\s\S]*src=\{familiar\.avatarImage\}[\s\S]*className="h-full w-full object-cover"[\s\S]*fallback=/,
  "Avatar preview enlarges uploaded avatar images via the authenticated image renderer",
);

assert.match(
  source,
  /setViewMode\("agent-memory"\)/,
  "Header button switches to agent-memory mode",
);

assert.doesNotMatch(
  source,
  /pendingCanonicalMemorySelection/,
  "the vault's deep-link selection prop is retired",
);
assert.doesNotMatch(
  source,
  /Memory across all agents/,
  "Familiars view should not expose global all-agents memory copy",
);

assert.match(
  source,
  /<h1[^>]*>Familiars<\/h1>/,
  "Page heading uses Familiars instead of Agents",
);

assert.match(
  source,
  /Familiar memory/,
  "Memory action uses singular Familiar copy",
);

assert.match(
  source,
  /activeFamiliar=\{familiar\}[\s\S]*lockToFamiliar/,
  "Familiar memory overlay passes the selected familiar and locks the memory filter",
);

assert.match(
  source,
  /onClose=\{\(\) => setViewMode\(selectedFamiliarId \? "detail" : "roster"\)\}/,
  "Closing the overlay restores the previous viewMode based on selection",
);

assert.match(
  source,
  /FamiliarsEmptyState[\s\S]*onOpenOnboarding/,
  "Empty state CTA wires to onOpenOnboarding",
);

assert.match(
  source,
  /lockToFamiliar/,
  "Memory tab inside detail passes lockToFamiliar to FamiliarsMemoryView",
);

assert.match(
  source,
  /const familiarFileEntries = useMemo\([\s\S]*entry\.familiarId === familiar\.id[\s\S]*\[fileEntries, familiar\.id\]/,
  "Files tab filters memory files to the selected familiar",
);

assert.match(
  source,
  /entries=\{familiarFileEntries\}/,
  "Files tab passes only the selected familiar's files to MemoryFilesList",
);

assert.match(
  source,
  /listClassName="h-full min-h-0 divide-y divide-\[var\(--border-hairline\)\] overflow-y-auto"/,
  "Files tab gives MemoryFilesList a panel-height scroll container",
);

assert.doesNotMatch(
  source,
  /list is the same for every familiar/,
  "Files tab should not describe the per-familiar list as global",
);

assert.match(
  source,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Overlay exposes modal dialog semantics",
);

assert.match(
  source,
  /\{ id: "daily-notes", label: "Daily Notes" \}/,
  "Detail panel exposes a Daily Notes tab",
);

assert.match(
  source,
  /tab === "daily-notes" \? \(\s*<FamiliarDailyNotes familiar=\{familiar\} \/>/,
  "Daily Notes tab renders FamiliarDailyNotes scoped to the selected familiar",
);

// Detail tabs use the shared accessible <Tabs> (role=tab/aria-selected/roving),
// not a hand-rolled button strip with aria-current="page".
assert.match(source, /import \{ Tabs \} from "@\/components\/ui\/tabs"/, "imports shared Tabs");
assert.match(source, /<Tabs[\s\S]{0,200}?idPrefix="familiar-detail"/, "detail panel uses shared Tabs with idPrefix");
assert.match(source, /role="tabpanel"[\s\S]{0,120}?aria-labelledby=\{`familiar-detail-tab-/, "content area is a labelled tabpanel");
assert.doesNotMatch(source, /aria-current=\{tab === id \? "page"/, "old aria-current=page tab pattern is gone");

console.log("familiars-view: all assertions passed");

// The detail panel header carries a per-familiar overflow menu — the
// discoverable entry points for Edit-in-Studio and Remove. Remove must ROUTE
// to the Studio Identity tab (its lifecycle section owns the canonical
// confirm + undo + tombstone flow), never confirm or DELETE from this surface.
assert.match(
  source,
  /aria-label=\{`\$\{familiar\.display_name\} options`\}[\s\S]{0,600}openFamiliarStudio\(familiar\.id, "identity"\)/,
  "Detail panel overflow menu opens the familiar's Studio (Edit in Studio)",
);
assert.match(
  source,
  /danger[\s\S]{0,200}openFamiliarStudio\(familiar\.id, "identity"\)[\s\S]{0,120}Remove familiar/,
  "Remove familiar routes to the Studio Identity tab where the canonical confirm lives",
);
assert.doesNotMatch(
  source,
  /fetch\([^)]*\/api\/familiars\/[^)]*\{\s*method:\s*"DELETE"/,
  "FamiliarsView never performs the destructive DELETE itself — that stays in the lifecycle section",
);

// Sessions tab: each row keeps its open-in-chat primary action AND gains a
// Trace action that opens the daemon event timeline (SessionTraceOverlay) —
// buttons are siblings, never nested (invalid HTML + broken AT semantics).
assert.match(
  source,
  /import \{ SessionTraceOverlay, type TraceTarget \} from "@\/components\/session-trace-overlay"/,
  "Sessions tab wires the shared trace overlay",
);
assert.match(
  source,
  /onClick=\{\(\) => openTrace\(\{ id: s\.id, title: s\.title \}\)\}/,
  "each session row can open its trace, through the history-aware opener so Back closes it",
);
assert.match(
  source,
  /className="familiars-view__analytics-link[^"]*"[\s\S]{0,180}?Analytics/,
  "roster cards present analytics as a primary, recognizable destination",
);
assert.match(
  source,
  /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/analytics`\}[\s\S]{0,220}?View analytics/,
  "the familiar detail header keeps analytics visible beside the core actions",
);
assert.match(
  source,
  /aria-label=\{`Trace \$\{s\.title \|\| s\.id\}`\}/,
  "the trace button names its session for AT",
);
assert.match(
  source,
  /\{traceTarget \? \(\s*<SessionTraceOverlay target=\{traceTarget\} onClose=\{closeTrace\} \/>\s*\) : null\}/,
  "the overlay renders from panel state and closes through the history-aware closer",
);

// ── cave-ibvl: the summon-event listener consumes the latch ──────────────────
// requestSummonFamiliar() arms the window-scoped latch unconditionally. A fresh
// FamiliarsView peeks without mutating during render, then consumes after commit;
// the live listener handles an already-mounted surface and consumes the latch
// so the next mount is not hijacked.
assert.match(
  source,
  /const \[createOpen, setCreateOpen\] = useState\(hasSummonPending\);/,
  "a fresh mount initializes open state from a pure latch peek",
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{\s*if \(createOpen\) consumeSummonPending\(\);\s*\}, \[createOpen\]\);/,
  "a committed open render consumes the summon latch before paint",
);
assert.match(
  source,
  /const open = \(\) => \{\s*consumeSummonPending\(\);\s*setCreateOpen\(true\);\s*\};/,
  "the already-mounted event listener also consumes the latch (cave-ibvl)",
);
