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

// Rehabilitation affordance: when the contract fails the familiar is an agent;
// the tab offers a button that opens a chat seeded with a remediation brief.
assert.match(
  source,
  /buildRehabilitationBrief/,
  "Tab builds a rehabilitation brief from the failing report",
);
assert.match(
  source,
  /!report\.pass\s*\?/,
  "Rehabilitation button only renders when the contract is failing",
);
assert.match(
  source,
  /"cave:agents-new-chat"/,
  "Rehab button opens a familiar-scoped chat via the agents-new-chat bridge",
);
assert.match(
  source,
  /initialPrompt:\s*buildRehabilitationBrief\(/,
  "Rehab chat is seeded with the rehabilitation brief as its initial prompt",
);
assert.match(
  source,
  /<Button[\s\S]*variant="primary"[\s\S]*Work with \{familiar\.display_name\} to fix this[\s\S]*<\/Button>/,
  "Rehab action uses the shared primary Button",
);

console.log("familiar-studio-contract-tab.test.ts: ok");
