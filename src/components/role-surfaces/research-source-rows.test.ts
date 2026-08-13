import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-source-rows.tsx", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");

test("the source ledger renders as a semantic table, not a div grid", () => {
  assert.match(source, /^"use client";/);
  // A ledger IS tabular: real table semantics give assistive tech row/column
  // position and header association without reconstructing them in ARIA.
  assert.match(source, /<table>/);
  assert.match(source, /<th scope="col">Status<\/th>/);
  assert.match(source, /<th scope="col">Source<\/th>/);
  assert.match(source, /<th scope="col">Publisher<\/th>/);
  assert.match(source, /<th scope="col">Claim<\/th>/);
  // The row header is the source itself, so a screen reader announces which
  // source each cell belongs to.
  assert.match(source, /<th scope="row" className="research-source-rows__title">/);
});

test("row state is announced, not conveyed by colour alone", () => {
  assert.match(source, /aria-current=\{isLatest \? "true" : undefined\}/);
  assert.match(source, /Most recently added/);
});

test("empty cells still render so columns stay aligned", () => {
  assert.match(source, /\{provenance \|\| "—"\}/);
  assert.match(source, /\{source\.claim\?\.trim\(\) \|\| "—"\}/);
});

test("the ledger uses the rows component and keeps every triage control", () => {
  assert.match(ledger, /<ResearchSourceRows/);
  assert.match(ledger, /renderActions=\{\(source\) =>/);
  // Switching layout must not quietly drop the verdicts a checkpoint waits on.
  assert.match(ledger, /Keep\s*<\/Button>/);
  assert.match(ledger, /Reject\s*<\/Button>/);
  assert.match(ledger, /Verify next pass/);
  assert.match(ledger, /research-source-revise/);
  // The old stacked-card layout must be gone, or both would render.
  assert.doesNotMatch(ledger, /className=\{`research-source-card/);
});
