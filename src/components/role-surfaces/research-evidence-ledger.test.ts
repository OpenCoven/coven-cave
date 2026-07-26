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

test("mission switches reset every piece of local ledger state", () => {
  // The reset effect clears the draft attach fields, per-key rejection map,
  // busy flag, and error banner together with the source filter — nothing
  // bleeds into the next mission's ledger.
  assert.match(
    source,
    /missionIdRef\.current = mission\.id;\s*setTitle\(""\);\s*setUrl\(""\);\s*setRejection\(\{\}\);\s*setBusy\(false\);\s*setError\(null\);\s*setSourceFilter\("all"\);\s*\}, \[mission\.id\]\)/,
  );
  // Panels remount per mission so uncontrolled disclosure state cannot ride
  // colliding artifact/source key shapes onto the wrong mission's rows.
  assert.match(source, /key=\{`artifacts-\$\{mission\.id\}`\}/);
  assert.match(source, /key=\{`sources-\$\{mission\.id\}`\}/);
});

test("act failures surface and never leak across a mission switch", () => {
  // { ok: false } from the hook is the primary error path…
  assert.match(source, /result\.error \?\? "Evidence could not be updated"/);
  // …a transport throw lands in the same error state (defense only — a throw
  // skips the ok branch, so a failure is never reported twice)…
  assert.match(source, /catch \(cause\)/);
  assert.match(source, /cause instanceof Error \? cause\.message : "Evidence could not be updated"/);
  // …busy always clears for the mission that set it…
  assert.match(source, /finally \{\s*if \(stillCurrent\(\)\) setBusy\(false\);\s*\}/);
  // …and an act settling after a mission switch is discarded via the id guard.
  assert.match(source, /const startedFor = mission\.id/);
  assert.match(source, /missionIdRef\.current === startedFor/);
});

test("ledger artifact cards mount the shared actions with publish wiring", () => {
  assert.match(source, /ResearchArtifactActions/);
  assert.match(source, /action: "publish-artifact"/);
  assert.match(source, /Artifact published to the Grimoire\./);
});
