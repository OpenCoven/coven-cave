// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as canonicalMemory from "../lib/canonical-memory.ts";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const familiarsView = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./familiars-view-sections.tsx", import.meta.url), "utf8");
const memoryView = readFileSync(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /useState<PendingCanonicalMemorySelection \| null>\(null\)/,
  "Workspace retains a typed selection across the lazy Agents mount",
);

const intentBranch = workspace.match(
  /if \(intent\.kind === "open-coven-memory"\) \{([\s\S]*?)\n\s*\}\n\s*if \(intent\.kind === "open-memory-file"\)/,
);
assert.ok(intentBranch, "Workspace handles canonical navigation separately from files");
assert.match(
  intentBranch[1],
  /const selection = \{\s*id:\s*intent\.id,\s*familiarId:\s*intent\.familiarId,\s*\};[\s\S]*setPendingCanonicalMemorySelection\(selection\)/,
  "Workspace stores only the opaque ID and familiar ID",
);
assert.match(
  intentBranch[1],
  /setRosterSettledPendingCanonicalMemorySelection\(null\);[\s\S]*pendingCanonicalMemorySelectionRef\.current = selection;[\s\S]*setPendingCanonicalMemorySelection\(selection\);[\s\S]*void loadFamiliars\(\);/,
  "a new canonical selection clears prior settlement, publishes its identity, and starts a fresh roster request",
);
assert.match(intentBranch[1], /setMode\("agents"\)/, "canonical navigation opens Agents");
assert.match(
  intentBranch[1],
  /shellRef\.current\?\.dismissNavMobile\(\)/,
  "canonical navigation dismisses mobile navigation",
);
assert.doesNotMatch(
  intentBranch[1],
  /path|CustomEvent|dispatchEvent|setTimeout/,
  "canonical navigation has no path or DOM event timing race",
);

assert.match(
  workspace,
  /pendingCanonicalMemorySelection=\{pendingCanonicalMemorySelection\}/,
  "Workspace passes the retained selection into lazy FamiliarsView",
);
assert.match(
  workspace,
  /onCanonicalMemorySelectionApplied=\{acknowledgeCanonicalMemorySelection\}/,
  "Workspace passes an acknowledgement bound to the current pending selection",
);
assert.match(
  workspace,
  /pendingRosterSettledSuccessfully=\{\s*rosterSettledPendingCanonicalMemorySelection ===\s*pendingCanonicalMemorySelection\s*\}/,
  "Workspace tells the lazy Familiars view only when a roster request bound to the exact pending selection succeeded",
);
assert.match(
  workspace,
  /onCanonicalMemorySelectionUnavailable=\{\s*rejectUnavailableCanonicalMemorySelection\s*\}/,
  "Workspace owns terminal unavailable-target rejection and feedback",
);
assert.match(
  workspace,
  /const pendingSelectionAtStart =\s*pendingCanonicalMemorySelectionRef\.current;[\s\S]*reconcilePendingCanonicalRosterSettlement\(\{[\s\S]*startedFor:\s*pendingSelectionAtStart,[\s\S]*succeeded:\s*true/,
  "each roster request captures the pending identity at start and reconciles successful settlement against it",
);
assert.match(
  workspace,
  /const loadFamiliarsReqRef = useRef\(0\);/,
  "Workspace owns a monotonic generation for familiar-roster requests",
);
const rosterLoadStart = workspace.indexOf(
  "const loadFamiliars = useCallback(async () => {",
);
const rosterLoadEnd = workspace.indexOf(
  "\n  // A roster load that failed",
  rosterLoadStart,
);
assert.ok(
  rosterLoadStart >= 0 && rosterLoadEnd > rosterLoadStart,
  "Workspace defines the familiar-roster loader",
);
const rosterLoad = workspace.slice(rosterLoadStart, rosterLoadEnd);
assert.match(
  rosterLoad,
  /const requestGeneration = \+\+loadFamiliarsReqRef\.current;[\s\S]*const isCurrent = \(\) =>\s*isLatestFamiliarRosterRequest\(\s*requestGeneration,\s*loadFamiliarsReqRef\.current,\s*\);/,
  "every roster request captures a generation and derives one current-request guard",
);
assert.match(
  rosterLoad,
  /const json = await res\.json\(\);\s*if \(!isCurrent\(\)\) return;\s*if \(!json\.ok\)/,
  "an older parsed success or daemon-error payload cannot publish state",
);
assert.match(
  rosterLoad,
  /\} catch \(err\) \{\s*if \(!isCurrent\(\)\) return;\s*setFamiliarsError/,
  "an older fetch or JSON failure cannot publish error state",
);
assert.match(
  rosterLoad,
  /\} finally \{\s*if \(isCurrent\(\)\) setFamiliarsLoaded\(true\);\s*\}/,
  "an older request cannot publish settled loading state",
);
assert.match(
  workspace,
  /const current = pendingCanonicalMemorySelectionRef\.current;[\s\S]*rejectPendingCanonicalMemorySelection\(\s*current,\s*expected,[\s\S]*if \(next === current\) return;[\s\S]*setPendingCanonicalMemorySelection\([\s\S]*pushToast\(\s*"Couldn't open memory — that familiar isn't available\. Refresh Familiars and try again\."/,
  "only an identity-current unavailable callback clears Workspace state and publishes actionable feedback",
);
assert.match(
  familiarsView,
  /pendingCanonicalMemorySelection\.familiarId[\s\S]*setViewMode\("agent-memory"\)/,
  "FamiliarsView applies familiar scope before opening memory",
);
assert.match(
  familiarsView,
  /pendingCanonicalMemorySelection[\s\S]*resolvedFamiliars\.find\([\s\S]*pendingCanonicalMemorySelection\.familiarId[\s\S]*const memoryFamiliar = pendingCanonicalMemorySelection/,
  "a pending target waits for that exact familiar instead of falling back to the prior active familiar",
);
assert.match(
  familiarsView,
  /if \(\s*pendingCanonicalMemorySelection &&\s*selectedFamiliarId === pendingCanonicalMemorySelection\.familiarId\s*\) \{\s*return;\s*\}/,
  "roster timing cannot let the invalid-selection cleanup erase an active pending target",
);
assert.match(
  familiarsView,
  /!pendingRosterSettledSuccessfully[\s\S]*pendingMemoryFamiliar[\s\S]*rejectedPendingSelectionRef\.current ===[\s\S]*pendingCanonicalMemorySelection[\s\S]*setViewMode\("roster"\);[\s\S]*onCanonicalMemorySelectionUnavailable\?\.\(\s*pendingCanonicalMemorySelection/,
  "only a successful roster request bound to the exact pending selection can terminally reject its missing familiar",
);
assert.match(
  sections,
  /pendingCanonicalMemorySelection=\{pendingCanonicalMemorySelection\}[\s\S]*onCanonicalMemorySelectionApplied=\{onCanonicalMemorySelectionApplied\}/,
  "the overlay preserves the handoff through its mount",
);

assert.match(
  memoryView,
  /const activePendingCanonicalRowId =[\s\S]*pendingCanonicalMemorySelection\?\.familiarId === effectiveFamiliarFilter[\s\S]*canonicalMemorySelectionRowId\(pendingCanonicalMemorySelection\)/,
  "only a pending target for the effective familiar can override selection",
);
const unifiedRowsStart = memoryView.indexOf(
  "const unifiedRows = useMemo(",
);
const unifiedRowsEnd = memoryView.indexOf(
  "const selectedRow = useMemo(",
  unifiedRowsStart,
);
assert.ok(
  unifiedRowsStart >= 0 && unifiedRowsEnd > unifiedRowsStart,
  "the memory view derives unified rows",
);
const unifiedRowsDerivation = memoryView.slice(
  unifiedRowsStart,
  unifiedRowsEnd,
);
assert.match(
  unifiedRowsDerivation,
  /query: normalizedQuery,[\s\S]*staleOnly,[\s\S]*rows\.some\(\(row\) => row\.rowId === activePendingCanonicalRowId\)/,
  "normal rows continue to honor the user's filters",
);
assert.match(
  unifiedRowsDerivation,
  /availableCanonicalEntries\.find\([\s\S]*entry\.id === pendingCanonicalMemorySelection\?\.id[\s\S]*entry\.familiarId === effectiveFamiliarFilter/,
  "only the exact pending canonical target can bypass filters",
);
assert.match(
  unifiedRowsDerivation,
  /canonical: \[pendingTarget\],[\s\S]*files: \[\],[\s\S]*query: "",[\s\S]*sourceFilter: "all",[\s\S]*staleOnly: false/,
  "the pending override injects one canonical row without changing file rows or preferences",
);
assert.match(
  unifiedRowsDerivation,
  /activePinnedCanonicalRow[\s\S]*!rows\.some\(\(row\) => row\.rowId === activePinnedCanonicalRow\.rowId\)[\s\S]*return \[activePinnedCanonicalRow, \.\.\.rows\]/,
  "the successfully applied row remains pinned without duplicating an ordinarily visible row",
);
assert.doesNotMatch(
  memoryView,
  /useEffect\(\(\) => \{\s*if \(!activePendingCanonicalRowId\)[\s\S]{0,400}set(?:Query|StaleOnly)\(/,
  "pending navigation does not mutate query or stale-only preferences",
);
const selectionWrite = memoryView.indexOf("setSelectedRowId(reconciled)");
const acknowledgement = memoryView.indexOf(
  "onCanonicalMemorySelectionApplied?.(",
);
assert.ok(selectionWrite >= 0, "the mounted memory view applies the opaque row ID");
assert.ok(
  acknowledgement > selectionWrite,
  "acknowledgement is observed only after the selected-row write",
);
const selectionEffectStart = memoryView.lastIndexOf(
  "useEffect(() => {",
  selectionWrite,
);
const selectionEffectEnd = memoryView.indexOf("]);", selectionWrite) + 3;
const selectionEffect = memoryView.slice(
  selectionEffectStart,
  selectionEffectEnd,
);
const acknowledgementEffectStart = memoryView.lastIndexOf(
  "useEffect(() => {",
  acknowledgement,
);
const acknowledgementEffectEnd =
  memoryView.indexOf("]);", acknowledgement) + 3;
const acknowledgementEffect = memoryView.slice(
  acknowledgementEffectStart,
  acknowledgementEffectEnd,
);
assert.match(
  selectionEffect,
  /activeCanonicalNavigationRowId \?\?[\s\S]*reconcileMemorySelection\([\s\S]*setSelectedRowId\(reconciled\)/,
  "pending or successfully applied pinned selection wins reconciliation until its matching row can render",
);
assert.match(
  acknowledgementEffect,
  /isCanonicalMemorySelectionApplied\([\s\S]*selectedRowId[\s\S]*setPinnedCanonicalSelection\([\s\S]*onCanonicalMemorySelectionApplied/,
  "acknowledgement pins the rendered row in the later state-observing effect before clearing pending state",
);
assert.doesNotMatch(
  selectionEffect,
  /onCanonicalMemorySelectionApplied/,
  "the state-applying effect cannot acknowledge before React applies selectedRowId",
);

const rowId = canonicalMemory.canonicalMemorySelectionRowId;
const isApplied = canonicalMemory.isCanonicalMemorySelectionApplied;
const acknowledge = canonicalMemory.acknowledgePendingCanonicalMemorySelection;
const rejectUnavailable =
  canonicalMemory.rejectPendingCanonicalMemorySelection;
const reconcileRosterSettlement =
  canonicalMemory.reconcilePendingCanonicalRosterSettlement;
assert.equal(typeof rowId, "function", "opaque row-ID behavior is exported for verification");
assert.equal(typeof isApplied, "function", "applied-state behavior is exported for verification");
assert.equal(typeof acknowledge, "function", "Workspace acknowledgement behavior is exported for verification");
assert.equal(
  typeof rejectUnavailable,
  "function",
  "Workspace unavailable-target rejection is exported for verification",
);
assert.equal(
  typeof reconcileRosterSettlement,
  "function",
  "Workspace pending-bound roster settlement is exported for verification",
);

if (
  typeof rowId === "function" &&
  typeof isApplied === "function" &&
  typeof acknowledge === "function" &&
  typeof rejectUnavailable === "function" &&
  typeof reconcileRosterSettlement === "function"
) {
  const first = { id: "memory-1", familiarId: "salem" };
  const repeated = { id: "memory-1", familiarId: "salem" };
  const switched = { id: "memory-2", familiarId: "charm" };

  assert.equal(rowId(first), "coven:memory-1");
  assert.equal(
    isApplied({
      pending: first,
      familiarId: "salem",
      selectedRowId: null,
      selectedMemoryId: null,
    }),
    false,
    "a pending selection is not acknowledged before selectedRowId is applied",
  );
  assert.equal(
    isApplied({
      pending: first,
      familiarId: "salem",
      selectedRowId: "coven:memory-1",
      selectedMemoryId: "memory-1",
    }),
    true,
    "the exact familiar, row ID, and resolved canonical row are required",
  );
  assert.equal(
    isApplied({
      pending: first,
      familiarId: "charm",
      selectedRowId: "coven:memory-1",
      selectedMemoryId: "memory-1",
    }),
    false,
    "late familiar props cannot acknowledge the wrong familiar",
  );

  assert.equal(
    acknowledge(repeated, first, "memory-1"),
    repeated,
    "a stale acknowledgement cannot clear a newer repeat of the same opaque ID",
  );
  assert.equal(
    acknowledge(switched, first, "memory-1"),
    switched,
    "an acknowledgement from the prior familiar cannot clear a newer selection",
  );
  assert.equal(
    acknowledge(first, first, "memory-2"),
    first,
    "a mismatched ID does not clear the current pending selection",
  );
  assert.equal(
    acknowledge(first, first, "memory-1"),
    null,
    "only the exact current selection and applied ID clear Workspace state",
  );
  assert.equal(
    rejectUnavailable(repeated, first),
    repeated,
    "a stale unavailable callback cannot clear a newer repeat of the same ID",
  );
  assert.equal(
    rejectUnavailable(switched, first),
    switched,
    "a stale unavailable callback cannot clear a newer familiar target",
  );
  assert.equal(
    rejectUnavailable(first, first),
    null,
    "only the exact current pending object is terminally rejected",
  );
  assert.equal(
    reconcileRosterSettlement({
      settled: null,
      current: first,
      startedFor: null,
      succeeded: true,
    }),
    null,
    "a request started before the pending selection cannot authorize rejection",
  );
  assert.equal(
    reconcileRosterSettlement({
      settled: repeated,
      current: repeated,
      startedFor: first,
      succeeded: true,
    }),
    null,
    "a stale same-ID response cannot leave the newer selection settled against its roster snapshot",
  );
  assert.equal(
    reconcileRosterSettlement({
      settled: first,
      current: first,
      startedFor: first,
      succeeded: false,
    }),
    null,
    "a fresh request failure clears settlement for its exact pending selection",
  );
  assert.equal(
    reconcileRosterSettlement({
      settled: null,
      current: first,
      startedFor: first,
      succeeded: true,
    }),
    first,
    "a fresh successful request settles its exact still-current pending selection",
  );
}

console.log("workspace-canonical-memory-navigation.test.ts OK");
