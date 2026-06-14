// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");

// Static-source assertions: the function must define a threshold + take the last 3 segments.
assert.match(
  source,
  /function compactPath\(path: string\): string \{/,
  "compactPath function must exist",
);
assert.match(
  source,
  /const THRESHOLD\s*=\s*52/,
  "compactPath must define a 52-char threshold for middle-ellipsis",
);
assert.match(
  source,
  /segments\.slice\(-3\)/,
  "compactPath must keep the last 3 segments when ellipsizing",
);
assert.match(
  source,
  /\/…\//,
  "compactPath must use the literal ellipsis between head and tail segments",
);

// Functional check via dynamic eval of the extracted body.
const fnMatch = source.match(/function compactPath\(path: string\): string \{([\s\S]*?)\n\}/);
assert.ok(fnMatch, "compactPath source body must be extractable for runtime check");
// Strip TypeScript type annotations to make body evaluatable as plain JS.
const body = fnMatch[1].replace(/: string/g, "");
const compactPath = new Function("path", body);

assert.equal(
  compactPath("/Users/buns/.openclaw/familiars/nova/memory/2026-06-03.md"),
  "~/.openclaw/familiars/nova/memory/2026-06-03.md",
  "Under-threshold path keeps full structure",
);
assert.equal(
  compactPath("/Users/buns/.openclaw/data/very/long/nested/path/familiars/nova/memory/2026-06-03.md"),
  "~/…/nova/memory/2026-06-03.md",
  "Over-threshold path collapses interior segments to ellipsis",
);
assert.equal(
  compactPath("/Users/buns/short.md"),
  "~/short.md",
  "Trivial path round-trips through the ~ replacement",
);

console.log("familiars-memory-view-compact-path.test.ts: ok");
