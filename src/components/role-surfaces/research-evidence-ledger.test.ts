import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-evidence-ledger.tsx", import.meta.url), "utf8");

test("evidence ledger exposes visible statuses and source revision", () => {
  for (const status of ["candidate", "used", "conflicting", "rejected"]) {
    assert.match(source, new RegExp(status));
  }
  assert.match(source, /attach-source/);
  assert.match(source, /update-source/);
});

test("sources triage at scale: filters, quiet attach, title-open affordance", () => {
  // Status chips carry live counts and a pressed state; empty statuses can't
  // be selected into a dead-end view.
  assert.match(source, /researchSourceStatusCounts\(mission\.sources\)/);
  assert.match(source, /aria-label="Filter sources by status"/);
  assert.match(source, /aria-pressed=\{sourceFilter === "all"\}/);
  assert.match(source, /aria-pressed=\{sourceFilter === status\}/);
  assert.match(source, /disabled=\{sourceCounts\[status\] === 0\}/);
  // Switching missions resets the filter instead of leaking it.
  assert.match(source, /setSourceFilter\("all"\);\s*\}, \[mission\.id\]\)/);
  // The filtered-out view says why it is empty.
  assert.match(source, /No \{sourceFilter\} sources\./);
  // The attach form waits behind a disclosure instead of topping the list.
  assert.match(source, /<details className="research-source-attach-disclosure">\s*<summary>Attach source<\/summary>/);
  // The card title is the open affordance; the separate button is gone.
  assert.match(source, /className="research-source-card__title"/);
  assert.match(source, /onClick=\{\(\) => onOpenUrl\(source\.url!\)\}/);
  assert.doesNotMatch(source, />Open source</);
  // The per-card status control keeps an accessible per-source name.
  assert.match(source, /<span className="sr-only">Status of \{source\.title\}<\/span>/);
});

test("artifact rejection is explicit and append-preserving", () => {
  assert.match(source, /reject-artifact/);
  assert.match(source, /Reject artifact/);
});
