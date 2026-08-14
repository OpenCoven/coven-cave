// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the legacy route preserves the representative Codex-direct stream contract", async () => {
  const home = await mkdtemp(path.join(homedir(), "cave-send-service-characterization-"));
  const workspace = path.join(home, "familiars", "opal");
  const bin = path.join(home, "bin");
  await mkdir(workspace, { recursive: true });
  await mkdir(bin, { recursive: true });

  const fixture = fileURLToPath(
    new URL("../fixtures/codex/0.145.0-tool-lifecycle.jsonl", import.meta.url),
  );
  const shim = path.join(bin, "codex");
  await writeFile(
    shim,
    `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("codex-cli 0.145.0"); process.exit(0); }
if (args.join(" ") === "exec --help") {
  console.log("--json\\nresume\\n--model\\n--sandbox\\n--add-dir\\n--skip-git-repo-check\\n--color");
  process.exit(0);
}
if (args.join(" ") === "exec resume --help") {
  console.log("--json\\n--model\\n--skip-git-repo-check");
  process.exit(0);
}
if (args[0] === "exec") {
  process.stdout.write(readFileSync(${JSON.stringify(fixture)}, "utf8"));
  process.exit(0);
}
process.exit(9);
`,
    { mode: 0o755 },
  );

  const previous = {
    home: process.env.COVEN_HOME,
    caveHome: process.env.COVEN_CAVE_HOME,
    codexBin: process.env.CODEX_BIN,
  };
  process.env.COVEN_HOME = home;
  process.env.COVEN_CAVE_HOME = path.join(home, "cave");
  process.env.CODEX_BIN = shim;

  try {
    const { clearCodexRuntimeDiscoveryCache } = await import("@/lib/codex-compatibility");
    const { saveConfig } = await import("@/lib/cave-config");
    const { createProject } = await import("@/lib/cave-projects");
    const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
    const { POST } = await import("@/app/api/chat/send/route");

    clearCodexRuntimeDiscoveryCache();
    await saveConfig({ familiars: { opal: { harness: "codex" } } });
    const project = await createProject({ name: "Characterization", root: workspace });
    await grantProjectToFamiliar({
      familiarId: "opal",
      projectId: project.id,
      source: "human",
      access: "write",
    });

    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "opal",
        prompt: "characterize direct send",
        projectRoot: workspace,
        runId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
      }),
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("connection"), "keep-alive");

    const streamText = await response.text();
    const dataFrames = streamText.split("\n\n").filter((frame) => frame.includes("data: "));
    // Some newer transport diagnostics are intentionally non-resumable. The
    // resumable frames still need a strictly increasing canonical sequence.
    const resumableFrames = dataFrames.filter((frame) => /^id: \d+$/m.test(frame));
    assert.ok(resumableFrames.length > 0, "the stream publishes resumable events");
    const ids = resumableFrames.map((frame) => Number(/^id: (\d+)$/m.exec(frame)?.[1]));
    assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
    const events = streamText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const startAt = events.findIndex((event) => event.kind === "session");
    const progressAt = events.findIndex((event) => event.kind === "progress");
    const textAt = events.findIndex(
      (event) => event.kind === "assistant_chunk" || event.kind === "assistant_replace",
    );
    const doneAt = events.findIndex((event) => event.kind === "done");
    assert.ok(startAt >= 0, `session/start is emitted: ${JSON.stringify(events)}`);
    assert.ok(progressAt >= 0, "progress is emitted");
    assert.ok(textAt > startAt, "assistant text follows start");
    assert.ok(doneAt > progressAt && doneAt > textAt, "done follows progress and text");
    assert.equal(
      events.filter((event) => event.kind === "assistant_chunk" || event.kind === "assistant_replace")
        .map((event) => event.text)
        .join(""),
      "Fixture assistant response.\n",
    );
  } finally {
    if (previous.home === undefined) delete process.env.COVEN_HOME;
    else process.env.COVEN_HOME = previous.home;
    if (previous.caveHome === undefined) delete process.env.COVEN_CAVE_HOME;
    else process.env.COVEN_CAVE_HOME = previous.caveHome;
    if (previous.codexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous.codexBin;
    await rm(home, { recursive: true, force: true });
  }
});

test("the route exports one canonical send entrypoint for HTTP and client callers", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(
    fileURLToPath(new URL("../../app/api/chat/send/route.ts", import.meta.url)),
    "utf8",
  );
  assert.match(route, /export async function executeChatSend\(req: Request\)/);
  assert.match(route, /export \{ executeChatSend as POST \};/);
});
