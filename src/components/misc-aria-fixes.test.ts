// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

// 1. Retired Salem has no floating assistant or answering controls.
{
  const src = read("salem/ask-salem-view.tsx");
  assert.doesNotMatch(
    src,
    /salem-perch|export function SalemWidget/,
    "floating Salem perch markup must stay removed",
  );
}

// 2. Sidebar collapse moved to the top-bar nav toggle, which exposes
// aria-expanded (covered by shell-edge-rails.test.ts). The sidebar header
// itself is now a static wordmark with no collapse button.
{
  const shell = read("shell.tsx");
  assert.ok(
    /shell-top-toggle--nav[\s\S]*?aria-expanded=\{navOpen\}/.test(shell),
    "the top-bar nav toggle exposes aria-expanded (in shell.tsx)",
  );
}

console.log("misc-aria-fixes.test.ts OK");
