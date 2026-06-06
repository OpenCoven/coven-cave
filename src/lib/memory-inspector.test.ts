// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectMemoryInspector,
  parseFailureDistillation,
  workspacePathForFamiliar,
} from "./memory-inspector.ts";

const failureText = `---
type: failure
id: failure-alpha
title: Alpha failure
date: 2026-06-05
severity: P2
domain: tooling
status: resolved
---

## Signal

Something broke.

## What happened

It failed and linked to [[failure-beta]].

## Root cause

Bad fallback.

## Lesson

Check the fallback.

## Watch for

Empty results.
`;

const parsed = parseFailureDistillation(failureText, "/tmp/failure-alpha.md");
assert.equal(parsed.id, "failure-alpha");
assert.equal(parsed.title, "Alpha failure");
assert.equal(parsed.severity, "P2");
assert.equal(parsed.domain, "tooling");
assert.equal(parsed.status, "resolved");
assert.equal(parsed.sections.Signal.trim(), "Something broke.");
assert.equal(parsed.sections["What happened"].includes("[[failure-beta]]"), true);
assert.deepEqual(parsed.wikilinks, ["failure-beta"]);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cave-memory-inspector-"));
const echoWorkspace = path.join(tempRoot, "echo");
await mkdir(path.join(echoWorkspace, "memory", "failures"), { recursive: true });
await mkdir(path.join(echoWorkspace, "memory", ".dreams"), { recursive: true });
await writeFile(path.join(echoWorkspace, "MEMORY.md"), "# Echo memory\n", "utf8");
await writeFile(
  path.join(echoWorkspace, "memory", "failures", "failure-alpha.md"),
  failureText,
  "utf8",
);
await writeFile(
  path.join(echoWorkspace, "memory", ".dreams", "phase-signals.json"),
  JSON.stringify({ version: 1, updatedAt: "2026-06-05T20:00:00.000Z", entries: { one: { lightHits: 2 } } }),
  "utf8",
);

assert.equal(workspacePathForFamiliar(tempRoot, "main"), tempRoot);
assert.equal(workspacePathForFamiliar(tempRoot, "echo"), echoWorkspace);
assert.throws(() => workspacePathForFamiliar(tempRoot, "../echo"), /invalid familiar id/);

const inspector = await collectMemoryInspector({ workspaceRoot: tempRoot, familiarId: "echo" });
assert.equal(inspector.ok, true);
assert.equal(inspector.failures.length, 1);
assert.equal(inspector.failures[0].id, "failure-alpha");
assert.equal(inspector.memoryTier.exists, true);
assert.equal(inspector.memoryTier.writeAuthority, "familiar");
assert.equal(inspector.dreams.active, true);
assert.equal(inspector.dreams.phaseSignals?.entryCount, 1);
assert.equal(inspector.dreams.shortTermRecall?.exists, false);

const codyWorkspace = path.join(tempRoot, "cody");
await mkdir(codyWorkspace, { recursive: true });
const emptyInspector = await collectMemoryInspector({ workspaceRoot: tempRoot, familiarId: "cody" });
assert.equal(emptyInspector.ok, true);
assert.deepEqual(emptyInspector.failures, []);
assert.equal(emptyInspector.memoryTier.exists, false);
assert.equal(emptyInspector.dreams.active, false);
