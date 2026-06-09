// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./inbox-escalations-view.tsx", import.meta.url), "utf8");

// ───────── Task 1: State rendered as neutral pill ─────────
assert.match(
  source,
  /<span className="ml-1\.5 inline-block rounded border border-border bg-card px-1 py-px text-\[9px\] uppercase tracking-widest text-muted-foreground align-middle">\s*\{item\.state\}\s*<\/span>/,
  "State must render as a neutral bordered pill after the timestamp",
);
assert.doesNotMatch(
  source,
  /\? <> · <span>\{item\.state\}<\/span><\/> :/,
  "Old `· {item.state}` middot-text shape must be removed",
);

console.log("inbox-escalations-view-polish.test.ts: ok");
