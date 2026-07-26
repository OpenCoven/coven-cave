// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Enhance-tasks button closes its loop (issue #2991) ───────────────────────
// The top-bar sparkle ran a whole enrichment pass and then said nothing —
// success, no-op, and failure all looked identical ("loading, then back to the
// start"). Every outcome now lands a toast.
assert.match(
  source,
  /pushToast\(\s*total === 0\s*\? "No open tasks to enhance right now\."/,
  "a run that found no tasks says so",
);
assert.match(
  source,
  /Open tasks already have steps — nothing to enhance\./,
  "a run that skipped everything says so",
);
assert.match(
  source,
  /Enhanced \$\{enhanced\} task\$\{enhanced === 1 \? "" : "s"\} — open Tasks to review\./,
  "a successful run states the count and where to look",
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
  /usePausablePoll\(\(\) => void loadFamiliars\(\), 4_000, \{\s*enabled: familiarsError !== null,\s*\}\)/,
  "loadFamiliars auto-retries every 4s while familiarsError is set",
);

console.log("workspace-feedback.test.ts: ok");
