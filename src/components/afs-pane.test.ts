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
    assert.match(source, /data\.path !== selected\.path/);
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
    assert.match(source, /entry\.toPath \? ` → \$\{entry\.toPath\}`/);
    assert.match(source, /<SessionTraceOverlay target=\{trace\.target\} focusSeq=\{trace\.focusSeq\}/);
  });

  it("requires a successful daemon dry run before a separate real commit", () => {
    assert.match(source, /Preview commit/);
    assert.match(source, /JSON\.stringify\(\{ branch, dryRun: true \}\)/);
    assert.match(source, /JSON\.stringify\(\{ branch \}\)/);
    assert.match(source, /No branch was created\./);
    assert.match(source, /Point-in-time validation passed/);
    assert.match(source, /Commit revalidates current state/);
    assert.match(source, /Commit current session state/);
    assert.match(source, /afsCommitDryRun/);
    assert.match(source, /preview\?\.phase === "ready"/);
    assert.match(source, /setPreview\(null\)/, "editing the branch invalidates the preview");
    assert.match(source, /readAfsCommitResult/);
    assert.match(source, /commit\.id !== session\.id/);
    assert.match(source, /data\.branch !== requestedBranch/);
    assert.match(source, /commit\.branch !== requestedBranch/);
  });

  it("implements complete keyboard tab relationships", () => {
    assert.match(source, /aria-controls=\{`afs-panel-\$\{id\}`\}/);
    assert.match(source, /tabIndex=\{tab === id \? 0 : -1\}/);
    assert.match(source, /event\.key === "ArrowRight"/);
    assert.match(source, /event\.key === "Home"/);
    assert.match(source, /role="tabpanel"/);
    assert.match(source, /aria-labelledby="afs-tab-changes"/);
    assert.match(source, /flex min-h-0 flex-1 flex-col overflow-hidden/);
  });
});
