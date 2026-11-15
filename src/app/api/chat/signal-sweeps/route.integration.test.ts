import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

const directory = await mkdtemp(path.join(tmpdir(), "signal-admission-"));
process.env.COVEN_HOME = path.join(directory, "coven");
process.env.COVEN_CAVE_HOME = path.join(directory, "cave");
delete process.env.COVEN_CAVE_AUTH_TOKEN;
const script = path.join(directory, "coven.cjs");
await mkdir(path.join(directory, "bin"));
const binary = path.join(directory, "bin", process.platform === "win32" ? "coven.cmd" : "coven");
await writeFile(binary, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n`
  : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
process.env.COVEN_BIN = binary;
const install = (supported: boolean) => writeFile(script, `console.log(${JSON.stringify(supported ? "--permission --write-scope <FILE>" : "--permission")});\n`);
try {
  await install(false);
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { appendSelfReport } = await import("@/lib/server/familiar-self-reports");
  const { familiarWorkspace } = await import("@/lib/coven-paths");
  const { GET, POST } = await import("./route.ts");
  await saveConfig({ familiars: { nova: { harness: "claude" }, sage: { harness: "codex" } } });
  const report: ThreadSelfReport = {
    id: "report-admission", familiarId: "nova", sessionId: "synthetic-source", reportedAt: "2026-11-14T10:00:00Z",
    overallConfidence: 90, toolReliability: { score: 90, failedTools: [], unreliableTools: [] }, contextPressure: "adequate",
    skillsUsed: [], skillsNeedingClarity: [], skillsNeedingAccess: [], capabilitiesLacking: [], capabilitiesVital: [],
    memoryRecallScore: 90, fileLocatabilityScore: 90,
    persistentBlockers: [{ id: "write-boundary", title: "Synthetic write boundary", category: "tooling", impact: "blocking", detail: "Synthetic prerequisite" }],
  };
  await appendSelfReport("nova", report);
  const root = path.join(directory, "project"); await mkdir(root);
  const project = await createProject({ name: "Synthetic project", root });
  await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "write" });
  const read = () => GET(new Request("http://localhost/api/chat/signal-sweeps?familiarId=nova"));
  const post = (body: unknown, origin = "http://localhost") => POST(new Request("http://localhost/api/chat/signal-sweeps", {
    method: "POST", headers: { host: "localhost", origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const request = { action: "prepare", familiarId: "nova", sourceReportId: report.id, identities: ["blocker:write-boundary"] };
  const blocked = await (await read()).json();
  assert.equal(blocked.available, false); assert.match(blocked.error, /cannot enforce project write access/);
  assert.equal((await post(request)).status, 409, "unsupported Build never gets a handoff reservation");
  assert.equal((await post(request, "https://untrusted.invalid")).status, 403);
  await install(true);
  const ready = await (await read()).json();
  assert.equal(ready.available, true); assert.notEqual(ready.revision, blocked.revision);
  const first = await (await post(request)).json(); assert.equal(first.ok, true);
  assert.equal((await post({ action: "commit", familiarId: "nova", requestId: first.requestId })).status, 200);
  assert.equal((await post(request)).status, 409);
  assert.equal((await post({ ...request, identities: [JSON.stringify(["blocker", "write-boundary", "synthetic-source"])] })).status, 409, "alternate encodings cannot mint another receipt for the same blocker");
  await appendSelfReport("nova", { ...report, id: "healthy-unrelated", sessionId: "other-source", reportedAt: "2026-11-15T10:00:00Z", persistentBlockers: [] });
  assert.equal((await post(request)).status, 409, "an unrelated healthy report cannot erase an unresolved source’s receipt");
  assert.equal((await post({ ...request, familiarId: "sage" })).status, 409, "a familiar cannot claim another familiar’s persisted report");
  assert.equal((await post({ ...request, expectedPrevious: { "blocker:write-boundary": "00000000-0000-0000-0000-000000000000" } })).status, 409, "stale retry intent cannot bypass the receipt");
  await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "read" });
  const changed = await (await post({ ...request, expectedPrevious: first.receipts })).json();
  assert.equal(changed.ok, true, "explicit retry replaces the observed receipt after human prerequisite changes; send still enforces current grants");
  assert.equal((await post({ ...request, expectedPrevious: changed.receipts })).status, 200, "a lost commit acknowledgement is recoverable through an explicit CAS retry");
  assert.equal((await post({ ...request, identities: [] })).status, 400);
  assert.equal((await post({ ...request, identities: Array(101).fill("x") })).status, 400);
  assert.equal((await post({ ...request, familiarId: "../private" })).status, 400);
  assert.equal((await post(null)).status, 400);
  await writeFile(path.join(await familiarWorkspace("nova"), "self-reports", "corrupt.jsonl"), "invalid\n");
  assert.equal((await post(request)).status, 409, "an invalid report row cannot erase the durable duplicate guard");
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("signal-sweeps route: ok");
