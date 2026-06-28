import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFamiliarContractFiles,
  creatureForGlyph,
  DEFAULT_PERSON,
  type IdentityScaffoldInput,
} from "./familiar-identity-scaffold.ts";
import { evaluateFamiliarContract, FAMILIAR_PROPERTIES } from "./familiar-contract.ts";

function reportFor(input: IdentityScaffoldInput) {
  const f = buildFamiliarContractFiles(input);
  return evaluateFamiliarContract({ soul: f.soul, identity: f.identity, ward: f.ward, memory: f.memory });
}

test("a full-input scaffold passes the contract with zero violations AND warnings", () => {
  const report = reportFor({
    id: "nova",
    displayName: "Nova",
    role: "Research familiar",
    description: "find and summarize papers and keep a living reading list",
    glyph: "ph:books-fill",
    person: "Val",
  });
  assert.equal(report.violations.length, 0, JSON.stringify(report.violations, null, 2));
  assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings, null, 2));
  assert.equal(report.pass, true);
  // Every one of the five normative properties is green (Persistent Memory too,
  // because we scaffold MEMORY.md).
  for (const prop of FAMILIAR_PROPERTIES) {
    assert.ok(
      report.properties.find((p) => p.property === prop)?.pass,
      `${prop} should pass`,
    );
  }
});

test("a minimal scaffold (name only) still passes cleanly", () => {
  const report = reportFor({ id: "aurora", displayName: "Aurora" });
  assert.equal(report.violations.length, 0, JSON.stringify(report.violations, null, 2));
  assert.equal(report.warnings.length, 0);
  assert.equal(report.pass, true);
});

test("SOUL name and ward familiar match (cross-file invariant)", () => {
  // A multi-word display name must stay consistent across SOUL.md and ward.toml.
  const report = reportFor({ id: "nova-prime", displayName: "Nova Prime" });
  assert.equal(report.violations.filter((v) => v.file === "cross-file").length, 0);
  assert.equal(report.pass, true);
});

test("names with quotes/hashes don't break the ward parser", () => {
  const report = reportFor({ id: "weird", displayName: 'Od#d "Name"' });
  assert.equal(report.pass, true, JSON.stringify(report.violations, null, 2));
});

test("defaults: person falls back to DEFAULT_PERSON and is a protected invariant", () => {
  const { ward } = buildFamiliarContractFiles({ id: "x", displayName: "X" });
  assert.match(ward, new RegExp(`person = "${DEFAULT_PERSON}"`));
  assert.match(ward, new RegExp(`familiar\\.person == '${DEFAULT_PERSON}'`));
});

test("creatureForGlyph maps known glyphs and falls back to Familiar", () => {
  assert.equal(creatureForGlyph("ph:cat-fill"), "Cat familiar");
  assert.equal(creatureForGlyph("ph:does-not-exist"), "Familiar");
  assert.equal(creatureForGlyph(undefined), "Familiar");
});
