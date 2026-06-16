import assert from "node:assert/strict";
import { buildRehabilitationBrief, needsRehabilitation } from "./familiar-rehabilitation.ts";
import type { ContractReport } from "./familiar-contract.ts";

function failingReport(): ContractReport {
  return {
    specVersion: "0.1.0",
    pass: false,
    properties: [
      { property: "Named Identity", pass: false },
      { property: "Defined Purpose", pass: false },
      { property: "Bounded Authority", pass: true },
      { property: "Persistent Memory", pass: true },
      { property: "Human Belonging", pass: true },
    ],
    violations: [
      { file: "SOUL.md", field: "name", message: 'No "## I am <Name>" section found.' },
      { file: "SOUL.md", field: "purpose", message: "No purpose declaration found." },
      { file: "IDENTITY.md", field: "creature", message: 'No "**Creature:**" field found.' },
    ],
    warnings: [{ file: "MEMORY.md", field: "size", message: "MEMORY.md is thin." }],
  };
}

function passingReport(): ContractReport {
  return {
    specVersion: "0.1.0",
    pass: true,
    properties: [
      { property: "Named Identity", pass: true },
      { property: "Defined Purpose", pass: true },
      { property: "Bounded Authority", pass: true },
      { property: "Persistent Memory", pass: true },
      { property: "Human Belonging", pass: true },
    ],
    violations: [],
    warnings: [],
  };
}

// needsRehabilitation tracks report.pass.
assert.equal(needsRehabilitation(failingReport()), true, "failing report needs rehabilitation");
assert.equal(needsRehabilitation(passingReport()), false, "passing report does not");

const brief = buildRehabilitationBrief("Sage", failingReport());

// Addresses the familiar by name.
assert.match(brief, /Sage/, "brief names the familiar");
// Frames the agent -> familiar crossing.
assert.match(brief, /agent/i, "brief names the current agent status");
assert.match(brief, /familiar/i, "brief names the familiar goal");

// Lists the failing properties (and not the passing ones as failures).
assert.match(brief, /Named Identity/, "lists a failed property");
assert.match(brief, /Defined Purpose/, "lists a failed property");

// Includes the specific violations, grouped by file, with field + message.
assert.match(brief, /### SOUL\.md/, "groups violations under SOUL.md");
assert.match(brief, /### IDENTITY\.md/, "groups violations under IDENTITY.md");
assert.match(brief, /No purpose declaration found\./, "carries the violation message verbatim");
assert.match(brief, /\*\*creature\*\*/, "carries the violation field");

// Surfaces warnings distinctly.
assert.match(brief, /MEMORY\.md.*thin/, "surfaces warnings");

// Instructs a collaborative, human-confirmed procedure ending in a re-check.
assert.match(brief, /show it to me/i, "instructs proposing content to the human first");
assert.match(brief, /Re-run check/i, "instructs re-running the contract check");

// Deterministic: same input -> identical output (no clock/randomness).
assert.equal(
  buildRehabilitationBrief("Sage", failingReport()),
  brief,
  "brief is deterministic for identical input",
);

// Passing report yields a short, non-actionable message rather than throwing.
const passBrief = buildRehabilitationBrief("Sage", passingReport());
assert.match(passBrief, /already bound|nothing to rehabilitate/i, "passing report gives a no-op brief");

// Empty name falls back without crashing.
assert.match(buildRehabilitationBrief("  ", failingReport()), /familiar/, "blank name falls back");

console.log("familiar-rehabilitation.test.ts: ok");
