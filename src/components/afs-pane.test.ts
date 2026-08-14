// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./afs-pane.tsx", import.meta.url), "utf8");

describe("AfsPane daemon review surfaces", () => {
  it("lazily loads one selected daemon patch in a responsive review container", () => {
    assert.match(source, /@container\/afs-review/);
    assert.match(source, /encodeURIComponent\(selected\.path\)/);
    assert.match(source, /Back to changes/);
    assert.match(source, /<pre[\s\S]*\{fileDiff\.data\.patch\}/);
    assert.match(source, /fileDiff\.data\.binary/);
    assert.match(source, /fileDiff\.data\.truncated/);
    assert.match(source, /selected\.attribution === "unknown"/);
  });

  it("loads cursor pages, renders linked tool details, and traces the owning session event", () => {
    assert.match(source, /mergeTimelinePages/);
    assert.match(source, /state\.data\.nextCursor/);
    assert.match(source, /Load more operations/);
    assert.match(source, /entry\.toolCall/);
    assert.match(source, /Linked tool details unavailable/);
    assert.match(source, />unlinked</);
    assert.match(source, /target: \{ id: entry\.sessionId/);
    assert.match(source, /focusSeq: entry\.turn/);
    assert.match(source, /<SessionTraceOverlay target=\{trace\.target\} focusSeq=\{trace\.focusSeq\}/);
  });

  it("requires a successful daemon dry run before a separate real commit", () => {
    assert.match(source, /Preview commit/);
    assert.match(source, /JSON\.stringify\(\{ branch, dryRun: true \}\)/);
    assert.match(source, /JSON\.stringify\(\{ branch \}\)/);
    assert.match(source, /No branch was created\./);
    assert.match(source, /preview\?\.phase === "ready"/);
    assert.match(source, /setPreview\(null\)/, "editing the branch invalidates the preview");
  });
});
