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

// ───────── Task 2: Severity text badge gated on critical only ─────────
assert.match(
  source,
  /\{item\.severity === "critical" \? \(\s*<span/,
  "Severity text badge must be gated on item.severity === 'critical'",
);
assert.doesNotMatch(
  source,
  /^\s*<span\s+className=\{`shrink-0 rounded border px-1\.5 py-px text-\[9px\] uppercase tracking-widest \$\{sevColor\}`\}\s+title=\{item\.severityReason \?\? SEVERITY_LABEL\[item\.severity\]\}>\s*\{SEVERITY_LABEL\[item\.severity\]\}\s*<\/span>$/m,
  "Unconditional severity badge render must be gone",
);

// ───────── Task 3: Show resolved count ─────────
assert.match(
  source,
  /const resolvedCount = items\.filter\(\(i\) => i\.state === "resolved"\)\.length;/,
  "resolvedCount must be derived from items",
);
assert.match(
  source,
  /Show resolved\{resolvedCount > 0 \? ` \(\$\{resolvedCount\}\)` : ""\}/,
  "Show resolved label must include count when > 0",
);

// ───────── Task 4: Per-row hover affordance ─────────
assert.match(
  source,
  /onPromoteToActive:\s*\(\) => void;/,
  "EscalationRow must accept onPromoteToActive prop",
);
assert.match(
  source,
  /aria-label="Show actions"/,
  "Hover affordance button must carry aria-label='Show actions'",
);
assert.match(
  source,
  /onPromoteToActive=\{\(\) => onActivate\(idx\)\}/,
  "renderRow must wire onPromoteToActive to onActivate(idx)",
);
assert.match(
  source,
  /opacity-0 group-hover:opacity-100[^"]*"[\s\S]{0,200}aria-label="Show actions"/,
  "Hover affordance must use opacity-0 group-hover:opacity-100",
);

console.log("inbox-escalations-view-polish.test.ts: ok");
