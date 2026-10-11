// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = await mkdtemp(path.join(os.tmpdir(), "cave-note-route-"));
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.COVEN_WORKSPACES_ROOT = path.join(root, "workspaces");
const { GET, POST } = await import("./route.ts");
const ctx = { params: Promise.resolve({ id: "sage" }) };
const post = (body) => POST(new Request("http://localhost/api/familiars/sage/notes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
try {
  for (const body of [null, {}, { date: "2026-02-30", reflection: "Hello" }, { date: "2999-01-01", reflection: "Hello" }, { date: "2026-10-01", reflection: " " }]) assert.equal((await post(body)).status, 400);
  assert.equal((await GET(new Request("http://localhost/?from=2026-10-01&to=2026-10-02"), { params: Promise.resolve({ id: "../sage" }) })).status, 403);
  assert.equal((await GET(new Request("http://localhost/?from=2026-01-01&to=2026-10-02"), ctx)).status, 400);
  const malformed = await POST(new Request("http://localhost/", { method: "POST", body: "{" }), ctx);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "invalid json");
  const denied = await POST(new Request("http://localhost/", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "../sage" }) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "path not allowed");
  const inactive = await post({ date: "2026-10-01", reflection: "An invented day" });
  assert.equal((await inactive.json()).status, "inactive");
  const file = path.join(root, "workspaces/familiars/sage/memory/lesson.md");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "Check evidence before claiming success.");
  const stamp = new Date(2026, 9, 1, 12);
  await utimes(file, stamp, stamp);
  const get = await GET(new Request("http://localhost/?from=2026-10-01&to=2026-10-02"), ctx);
  const data = await get.json();
  assert.equal(data.days.length, 1);
  assert.equal(data.days[0].date, "2026-10-01");
  assert.equal((await (await post({ date: "2026-10-01", reflection: "I checked the evidence." })).json()).status, "generated");
  assert.equal((await (await post({ date: "2026-10-01", reflection: "Replace it" })).json()).status, "existing");
  console.log("daily-note generation route: all assertions passed");
} finally { await rm(root, { recursive: true, force: true }); }
