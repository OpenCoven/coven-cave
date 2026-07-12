// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import {
  __resetBoundaryRemindersForTest,
  buildPromptWithBoundaryReminder,
  createBoundarySentinel,
  formatBoundaryNotice,
  recordBoundaryViolations,
  takeBoundaryReminder,
} from "./chat-boundary-sentinel.ts";

const home = path.resolve("/Users/test");
const tmp = path.resolve("/tmp/cave-test");
const primary = path.join(home, "code", "primary");
const granted = path.join(home, "code", "granted");
const workspace = path.join(home, ".coven", "workspaces", "familiars", "cody");
const foreign = path.join(home, "code", "foreign");

const makeSentinel = () =>
  createBoundarySentinel({
    allowedRoots: [primary, granted, workspace],
    homeDir: home,
    tmpDir: tmp,
  });

// In-scope paths never flag: primary, granted, workspace, tmp, system paths.
{
  const s = makeSentinel();
  s.observe("Read", { file_path: path.join(primary, "src", "index.ts") });
  s.observe("Edit", { file_path: path.join(granted, "README.md") });
  s.observe("Write", { file_path: path.join(workspace, "memory", "2026-07-11.md") });
  s.observe("Read", { file_path: path.join(tmp, "attachment.png") });
  s.observe("Bash", { command: "/usr/bin/env node --version" });
  s.observe("Bash", { command: `ls ${path.join(home, "code")}` }); // parent of granted roots
  assert.deepEqual(s.violations(), [], "in-scope and system paths must not flag");
}

// Out-of-boundary user-space paths flag, deduped, from key + command sources.
{
  const s = makeSentinel();
  s.observe("Read", { file_path: path.join(foreign, "secrets.env") });
  s.observe("Read", { file_path: path.join(foreign, "secrets.env") }); // dup
  s.observe("Bash", { command: `cat ${path.join(home, "other", "notes.md")} | head` });
  s.observe("Bash", { command: "grep -r token ~/other2/config" });
  const paths = s.violations().map((v) => v.path);
  assert.deepEqual(
    paths,
    [
      path.join(foreign, "secrets.env"),
      path.join(home, "other", "notes.md"),
      path.join(home, "other2", "config"),
    ],
    "out-of-boundary home paths flag once each (incl. ~ expansion)",
  );
}

// Paths inside written CONTENT are mentions, not touches.
{
  const s = makeSentinel();
  s.observe("Write", {
    file_path: path.join(primary, "docs", "map.md"),
    content: `See ${foreign}/README.md and ${path.join(home, "other", "x.ts")}`,
  });
  s.observe("Edit", {
    file_path: path.join(primary, "a.ts"),
    old_str: `import "${foreign}/x";`,
    new_str: `import "${foreign}/y";`,
  });
  assert.deepEqual(s.violations(), [], "content bodies must not flag mentioned paths");
}

// Hook payloads arrive as serialized JSON strings — same rules apply.
{
  const s = makeSentinel();
  s.observe("Edit", JSON.stringify({ file_path: path.join(foreign, "z.ts"), new_str: "x" }));
  s.observe("Write", JSON.stringify({ file_path: path.join(primary, "ok.ts"), content: `${foreign}/mention` }));
  assert.deepEqual(
    s.violations().map((v) => v.path),
    [path.join(foreign, "z.ts")],
    "hook JSON strings classify like envelope inputs",
  );
}

// The violation cap holds.
{
  const s = makeSentinel();
  for (let i = 0; i < 20; i++) {
    s.observe("Read", { file_path: path.join(home, "spread", `f${i}.txt`) });
  }
  assert.equal(s.violations().length, 8, "violations are capped per turn");
}

// Notice formatting names the path and the tool.
{
  const s = makeSentinel();
  s.observe("Read", { file_path: path.join(foreign, "a.txt") });
  assert.equal(
    formatBoundaryNotice(s.violations()),
    `${path.join(foreign, "a.txt")} (Read)`,
  );
}

// Reminder registry: record → consume-once → gone; no session id → no-op.
{
  __resetBoundaryRemindersForTest();
  recordBoundaryViolations("sess-1", [{ tool: "Read", path: `${foreign}/a` }]);
  assert.deepEqual(takeBoundaryReminder("sess-1"), [`${foreign}/a`]);
  assert.equal(takeBoundaryReminder("sess-1"), null, "reminders are consume-once");
  assert.equal(takeBoundaryReminder(null), null);
  assert.equal(takeBoundaryReminder("never-recorded"), null);
}

// Prompt wrapper: appends the corrective block only when a reminder is pending.
{
  __resetBoundaryRemindersForTest();
  assert.equal(
    buildPromptWithBoundaryReminder("prompt", "sess-2"),
    "prompt",
    "no pending reminder leaves the prompt untouched",
  );
  recordBoundaryViolations("sess-2", [
    { tool: "Read", path: `${foreign}/a` },
    { tool: "Bash", path: `${foreign}/a` }, // dup path collapses
  ]);
  const wrapped = buildPromptWithBoundaryReminder("prompt", "sess-2");
  assert.match(wrapped, /^prompt\n\nBoundary reminder \(from your previous turn\):/);
  assert.match(wrapped, /Stay inside the runtime filesystem boundary/);
  assert.equal(
    wrapped.split(`${foreign}/a`).length - 1,
    1,
    "duplicate paths are listed once in the reminder",
  );
  assert.equal(
    buildPromptWithBoundaryReminder("prompt", "sess-2"),
    "prompt",
    "building the prompt consumes the reminder",
  );
}

// Classification never throws on hostile input.
{
  const s = makeSentinel();
  const cyclic = {};
  cyclic.self = cyclic;
  s.observe("Weird", cyclic);
  s.observe("Weird", 42);
  s.observe("Weird", null);
  s.observe("Weird", "{not json");
  assert.deepEqual(s.violations(), []);
}

console.log("chat-boundary-sentinel.test.ts: ok");
