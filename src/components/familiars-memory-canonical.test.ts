import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const memoryView = readFileSync(
  new URL("./familiars-memory-view.tsx", import.meta.url),
  "utf8",
);
const memoryRow = readFileSync(
  new URL("./familiars-memory-row.tsx", import.meta.url),
  "utf8",
);
const fileReader = readFileSync(
  new URL("./familiars-memory-reader.tsx", import.meta.url),
  "utf8",
);
const familiarsView = readFileSync(
  new URL("./familiars-view.tsx", import.meta.url),
  "utf8",
);
const sections = readFileSync(
  new URL("./familiars-view-sections.tsx", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);
const settingsShell = readFileSync(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const familiarSettings = readFileSync(
  new URL("./familiar-tab-settings.tsx", import.meta.url),
  "utf8",
);
const studio = readFileSync(
  new URL("./familiar-studio-inline.tsx", import.meta.url),
  "utf8",
);
const studioMemory = readFileSync(
  new URL("./familiar-studio-memory-tab.tsx", import.meta.url),
  "utf8",
);

test("the memory feed keeps canonical, overview, and file states independent", () => {
  assert.match(memoryView, /export type MemoryFeed = \{/);
  assert.match(
    memoryView,
    /canonical:\s*\| \{ state: "loading"; entries: CanonicalMemorySummary\[\] \}\s*\| \{ state: "ready"; entries: CanonicalMemorySummary\[\] \}\s*\| \{ state: "error"; entries: CanonicalMemorySummary\[\]; error: CanonicalMemoryRequestError \}/,
  );
  assert.match(
    memoryView,
    /overview:\s*\| \{ state: "loading"; value: null \}\s*\| \{ state: "ready"; value: CanonicalMemoryOverview \}\s*\| \{ state: "error"; value: null; error: CanonicalMemoryRequestError \}/,
  );
  assert.match(
    memoryView,
    /files:\s*\| \{ state: "loading"; entries: FileMemoryEntry\[\] \}\s*\| \{ state: "ready"; entries: FileMemoryEntry\[\] \}\s*\| \{ state: "error"; entries: FileMemoryEntry\[\]; error: string \}/,
  );
});

test("shared landing resources back the feed and explicit refresh forces all three", () => {
  assert.match(familiarsView, /loadCanonicalMemoryList\(\)/);
  assert.match(familiarsView, /loadCanonicalMemoryOverview\(\)/);
  assert.match(
    familiarsView,
    /readSurfaceResource<FileMemoryResponse>\(\s*"memory:list",\s*false,\s*\)/,
  );
  assert.match(familiarsView, /refreshCanonicalMemory\(\)/);
  assert.match(
    familiarsView,
    /readSurfaceResource<FileMemoryResponse>\(\s*"memory:list",\s*true,\s*\)/,
  );
  assert.doesNotMatch(
    `${familiarsView}\n${memoryView}`,
    /fetch\(\s*["'`]\/api\/coven-memory/,
  );
});

test("canonical rows select opaque IDs and dispatch to the canonical reader", () => {
  assert.match(memoryView, /buildMemoryRows\(\{\s*canonical:/);
  assert.match(memoryView, /selectedRow\?\.kind === "canonical"/);
  assert.match(memoryView, /<CanonicalMemoryReader/);
  assert.match(memoryView, /memoryId=\{selectedRow\.memoryId\}/);
  assert.match(memoryView, /expandRow\?\.kind === "canonical"/);
  assert.match(memoryView, /selectMemoryRow\(`coven:\$\{entry\.id\}`\)/);
  assert.doesNotMatch(
    memoryView,
    /onOpenMemoryFile\?\.\(entry\.(?:path|fullPath|contentPath)\)/,
  );
});

test("missing canonical detail is recovered by the parent in compact and master-detail modes", () => {
  assert.equal(
    (memoryView.match(/onMissing=\{\(\) => handleMissingCanonicalMemory\(/g) ?? [])
      .length,
    2,
    "both canonical reader mounts delegate missing recovery to the parent",
  );
  assert.match(
    memoryView,
    /const handleMissingCanonicalMemory = useCallback\([\s\S]*?excludeMissingCanonicalMemory[\s\S]*?setSelectedRowId\(null\)[\s\S]*?setExpandRow\(null\)/,
    "missing recovery removes the stale summary and returns both layouts to the list",
  );
  assert.match(
    memoryView,
    /role="status"[\s\S]{0,500}Memory not found[\s\S]{0,500}Refresh/,
    "the returned list preserves an actionable not-found notice",
  );
  assert.match(
    memoryView,
    /reconcileMissingCanonicalRefresh\([\s\S]*refreshState:[\s\S]*entries:/,
    "coordinated refresh results own missing-notice reconciliation",
  );
});

test("cleanup and file actions narrow by discriminant", () => {
  assert.match(memoryView, /row\.kind === "file"/);
  assert.match(memoryRow, /row\.kind === "file"/);
  assert.match(fileReader, /row: FileMemoryRow \| null/);
  assert.doesNotMatch(memoryRow, /row\.kind === "canonical"[\s\S]{0,300}onDelete/);
  assert.doesNotMatch(memoryView, /normalizeCovenEntry|RawCovenEntry/);
});

test("overview and partial canonical failure remain visible without disabling files", () => {
  assert.match(memoryView, /<CanonicalMemoryOverviewPanel/);
  assert.match(memoryView, /canonicalState\.state === "error"/);
  assert.match(memoryView, /overviewState\.state === "error"/);
  assert.match(memoryView, /filesState\.state === "error"/);
  assert.match(
    memoryView,
    /canonicalStateFrom\(canonical\.list, current\.entries\)/,
    "a failed explicit canonical refresh keeps prior rows under an error state",
  );
  assert.match(
    memoryView,
    /data\.entries \?\? current\.entries/,
    "a file error without entries keeps prior file rows usable",
  );
  assert.match(memoryView, /MemoryFilesList[\s\S]*entries=\{visibleFiles\}/);
  assert.match(
    memoryView,
    /memoryListPresentation\(\{[\s\S]*canonicalState: canonicalState\.state,[\s\S]*filesState: filesState\.state,[\s\S]*rowCount: unifiedRows\.length/,
    "empty/loading/unavailable presentation is derived from both independent feeds",
  );
  assert.match(
    memoryView,
    /listPresentation === "empty"/,
    "true-empty renders only from the both-ready presentation",
  );
  assert.doesNotMatch(
    memoryView,
    /headline="Couldn't load (?:canonical overview|familiar memories|memory files)"[\s\S]{0,500}actions=/,
    "independently named errors rely on the enclosing coordinated recovery action",
  );
  assert.equal(
    (memoryView.match(/onClick=\{\(\) => void load\(true\)\}/g) ?? []).length,
    1,
    "the enclosing surface owns one coordinated Refresh action",
  );
});

test("local daemon readiness reaches every mounted canonical reader", () => {
  assert.match(workspace, /<FamiliarsView[\s\S]*localDaemonReady=\{localDaemonReady\}/);
  assert.match(familiarsView, /localDaemonReady: boolean/);
  assert.match(
    familiarsView,
    /<FamiliarMemoryOverlay[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  );
  assert.match(
    familiarsView,
    /<FamiliarDetailPanel[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  );
  assert.ok(
    (sections.match(/localDaemonReady=\{localDaemonReady\}/g) ?? []).length >= 2,
    "overlay and detail tab pass readiness to FamiliarsMemoryView",
  );
  assert.doesNotMatch(
    settingsShell,
    /useLocalDaemonReadiness/,
    "the retired Settings Familiars host no longer owns canonical readiness",
  );
  assert.match(
    familiarSettings,
    /localDaemonReady: boolean/,
    "Chat Familiar Settings receives the workspace-owned local readiness state",
  );
  assert.match(
    familiarSettings,
    /<FamiliarStudioMemoryTab[\s\S]*localDaemonReady=\{localDaemonReady\}/,
    "Chat Familiar Settings passes exact local readiness to its memory tab",
  );
  assert.match(
    studio,
    /<FamiliarStudioMemoryTab[\s\S]*localDaemonReady=\{localDaemonReady\}/,
  );
  assert.match(
    studioMemory,
    /<FamiliarsMemoryView[\s\S]*localDaemonReady=\{localDaemonReady\}/,
    "the Studio production mount receives exact accepted-local readiness",
  );
  assert.equal(
    [
      ...sections.matchAll(/<FamiliarsMemoryView[\s\S]*?\/>/g),
      ...studioMemory.matchAll(/<FamiliarsMemoryView[\s\S]*?\/>/g),
    ].filter(([mount]) => /localDaemonReady=\{localDaemonReady\}/.test(mount)).length,
    3,
    "all three production memory mounts carry local readiness",
  );
  assert.doesNotMatch(
    familiarSettings,
    /json\?\.ok[\s\S]{0,200}setAcceptedLocalDaemonHealthy\(true\)/,
    "a successful familiar roster response never implies canonical readiness",
  );
});

test("selection and async loads reconcile instead of publishing stale state", () => {
  assert.match(
    memoryView,
    /reconcileMemorySelection\(\{[\s\S]*selectedRowId,[\s\S]*rowIds: unifiedRows\.map/,
    "canonical and file selections are reconciled against the visible rows",
  );
  assert.match(
    memoryView,
    /const mountedRef = useRef\(true\)/,
    "the view tracks mounted state",
  );
  assert.match(
    memoryView,
    /const loadGenerationRef = useRef\(0\)/,
    "the view tracks load generations",
  );
  assert.match(
    memoryView,
    /const loadForceEpochRef = useRef\(0\)[\s\S]*const loadActiveForceEpochRef = useRef<number \| null>\(null\)/,
    "the view tracks the current explicit refresh owner independently",
  );
  assert.match(
    memoryView,
    /const startedDuringForcedRefresh =\s*!force && loadActiveForceEpochRef\.current !== null/,
    "background loads remember when the current explicit refresh owns publication",
  );
  assert.match(
    memoryView,
    /if \(\s*force &&\s*loadActiveForceEpochRef\.current === forceEpoch\s*\) \{\s*loadActiveForceEpochRef\.current = null/,
    "only the current standalone force token can release background publication",
  );
  assert.match(
    memoryView,
    /force\s*\?\s*forceEpoch === loadForceEpochRef\.current\s*:\s*!startedDuringForcedRefresh &&\s*forceEpoch === loadForceEpochRef\.current &&\s*generation === loadGenerationRef\.current/,
    "a forced load ignores later background request IDs while newer forced loads still supersede it",
  );
  assert.match(
    memoryView,
    /const isCurrent = \(\) =>\s*mountedRef\.current &&/,
    "every load publication checks mounted state",
  );
  assert.match(
    memoryView,
    /if \(!isCurrent\(\)\) return/,
    "late view loads cannot publish state",
  );
});

test("canonical reader integration carries no path or mutation target", () => {
  const canonicalBranches =
    memoryView.match(/selectedRow\?\.kind === "canonical"[\s\S]*?<CanonicalMemoryReader[\s\S]*?\/>/g) ??
    [];
  assert.ok(canonicalBranches.length > 0);
  for (const branch of canonicalBranches) {
    assert.doesNotMatch(
      branch,
      /\b(?:path|contentPath|onOpenMemoryFile|onDelete|openGrimoireDoc)\b/,
    );
  }
  assert.doesNotMatch(
    `${memoryView}\n${memoryRow}`,
    /\bRawCovenEntry\b|\bnormalizeCovenEntry\b/,
  );
});
