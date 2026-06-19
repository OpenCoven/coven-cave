// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

// 1. Salem perch is a real <button>, not a <div role="button">.
{
  const src = read("salem/salem-widget.tsx");
  assert.doesNotMatch(
    src,
    /<div[\s\S]{0,200}role="button"[\s\S]{0,200}salem-perch/,
    "salem perch must not be a div role=button (use real <button>)",
  );
  assert.match(
    src,
    /<button[\s\S]{0,200}salem-perch/,
    "salem perch is a <button> element",
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
