// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Enhance-tasks button closes its loop (issue #2991) ───────────────────────
// The top-bar sparkle ran a whole enrichment pass and then said nothing —
// success, no-op, and failure all looked identical ("loading, then back to the
// start"). Every outcome now lands a toast.
// The wording lives in enrich-tasks-summary.ts (tested there, #5629); the
// workspace folds every streamed event into the tally and toasts its summary.
assert.match(
  source,
  /tally = tallyEnrichTasksEvent\(tally, msg\);/,
  "every streamed task event is counted",
);
assert.match(
  source,
  /pushToast\(enrichTasksSummary\(tally\)\);/,
  "the run ends with a toast that accounts for every task",
);
assert.match(
  source,
  /pushToast\("Enhance tasks failed — check the daemon banner and try again\."\)/,
  "failures surface instead of being swallowed",
);
// pushToast must be declared BEFORE handleEnrichTasks — the deps array reads
// it at render time, and a later `const` would throw a TDZ ReferenceError.
assert.ok(
  source.indexOf("const pushToast = useCallback") < source.indexOf("const handleEnrichTasks = useCallback"),
  "pushToast is declared above handleEnrichTasks, which closes over it",
);

// ── Roster error self-heals (issue #2990) ────────────────────────────────────
// The daemonRunning effect only fires on TRANSITIONS; a one-off fetch flake
// with the daemon already running (first-familiar summon) stranded the error
// screen until a manual Retry. A quiet poll now retries while the error shows.
assert.match(
  source,
  /usePausablePoll\(\(\) => loadFamiliars\(\), 4_000, \{\s*serialize: true,\s*enabled: familiarsError !== null,\s*\}\)/,
  "loadFamiliars auto-retries every 4s while familiarsError is set",
);

// A serialized poll must settle even when the server stops responding, or a
// hung background request can suppress every later timer/focus refresh.
for (const name of ["loadFamiliars", "loadGitHubTasks", "loadSessions", "refreshEscalations"]) {
  const callback = source.slice(source.indexOf(`const ${name} = useCallback`)).split("}, []);")[0];
  assert.match(callback, /signal: (?:force \? undefined : )?AbortSignal\.timeout\(15_000\)/,
    `${name} bounds its background fetch so polling can recover`);
}

console.log("workspace-feedback.test.ts: ok");
