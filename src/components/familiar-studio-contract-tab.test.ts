// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-contract-tab.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudioContractTab/, "Must export the tab component");

// Fetches the per-familiar contract report from the guarded API route.
assert.match(
  source,
  /\/api\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/contract/,
  "Tab should fetch the familiar's contract report",
);
assert.match(source, /cache:\s*"no-store"/, "Report fetch should not be cached");

// Renders the overall verdict and the five-property coverage from the report.
assert.match(source, /report\.pass/, "Tab renders an overall pass/fail verdict");
assert.match(source, /report\.properties\.map/, "Tab renders per-property coverage");
assert.match(source, /report\.violations/, "Tab renders violations");
assert.match(source, /report\.warnings/, "Tab renders warnings");
assert.match(source, /report\.specVersion/, "Tab surfaces the spec version");

// Honest empty/error/loading states (no silent failure).
assert.match(source, /state === "loading"/, "Tab shows a loading state");
assert.match(source, /state === "error"/, "Tab shows an error state when the check can't run");

// Re-run affordance.
assert.match(source, /Re-run check/, "Tab offers a re-run control");
assert.match(source, /runCheck/, "Tab re-runs the check on demand");

// Links out to the spec so the check is legible.
assert.match(
  source,
  /github\.com\/OpenCoven\/familiar-contract/,
  "Tab links to the Familiar Contract spec",
);

// Shows which identity files are present on disk.
assert.match(source, /SOUL\.md/, "Tab lists SOUL.md");
assert.match(source, /IDENTITY\.md/, "Tab lists IDENTITY.md");
assert.match(source, /ward\.toml/, "Tab lists ward.toml");
assert.match(source, /MEMORY\.md/, "Tab lists MEMORY.md");

// Root class for styling.
assert.match(source, /familiar-studio-contract/, "Tab uses the contract BEM root class");

console.log("familiar-studio-contract-tab.test.ts: ok");
