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

// 2. Sidebar collapse toggle has aria-expanded.
{
  const a = read("sidebar-minimal.tsx");
  assert.ok(
    /aria-expanded/.test(a),
    "sidebar collapse toggle exposes aria-expanded (in sidebar-minimal.tsx)",
  );
}

console.log("misc-aria-fixes.test.ts OK");
