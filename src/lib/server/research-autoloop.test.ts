import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

let server: typeof import("./research-autoloop.ts") | null = null;
try {
  server = await import("./research-autoloop.ts");
} catch {
  // Deliberate first RED: keep the failure in the assertion layer.
}

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "cave-autoloop-"));
  const researchRoot = path.join(home, ".coven", "research");
  const ledgerDir = path.join(researchRoot, "autoresearch");
  const synthesisDir = path.join(researchRoot, "synthesis");
  const skillDir = path.join(researchRoot, "skills", "verified-skill");
  const logsDir = path.join(home, ".coven", "logs");
  await Promise.all([
    mkdir(ledgerDir, { recursive: true }),
    mkdir(synthesisDir, { recursive: true }),
    mkdir(skillDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);
  await writeFile(
    path.join(ledgerDir, "results.tsv"),
    "2026-07-26T10:00:00Z\tsynthesis\t83\tverified-synthesis\t0\t28\t+28\tPROMOTE\tmain\tVerified result\n",
  );
  await writeFile(
    path.join(synthesisDir, "verified-synthesis-2026-07-26.md"),
    "# Verified synthesis\n",
  );
  await writeFile(path.join(skillDir, "SKILL.md"), "# Verified skill\n");
  await writeFile(
    path.join(synthesisDir, "INDEX.md"),
    "| 2026-07-26 | [Verified](./verified-synthesis-2026-07-26.md) | synthesis | `verified-synthesis` |\n",
  );
  return { home, researchRoot, ledgerDir, synthesisDir, skillDir, logsDir };
}

test("server projection contract exists", () => {
  assert.ok(server, "server/research-autoloop.ts must load and watch the ledger");
  assert.equal(typeof server.loadAutoresearchSnapshot, "function");
  assert.equal(typeof server.readAutoresearchDocument, "function");
  assert.equal(typeof server.watchAutoresearchSources, "function");
});

test("loader projects authoritative rows and uses the synthesis index as a read-only legacy fallback", async () => {
  assert.ok(server);
  const fx = await fixture();
  const snapshot = await server.loadAutoresearchSnapshot(fx.home);

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(
    snapshot.rows[0].synthesisPath,
    await realpath(path.join(fx.synthesisDir, "verified-synthesis-2026-07-26.md")),
  );
  assert.equal(snapshot.rows[0].stagedSkillPath, null);
});

test("completion events enrich paths while containment blocks symlink escapes", async () => {
  assert.ok(server);
  const fx = await fixture();
  const outside = path.join(fx.home, "outside.md");
  const escaped = path.join(fx.synthesisDir, "escaped.md");
  await writeFile(outside, "# Outside\n");
  await symlink(outside, escaped);
  await writeFile(
    path.join(fx.logsDir, "autoloop.jsonl"),
    [
      JSON.stringify({
        ts: "2026-07-26T10:01:00Z",
        iter: 83,
        slug: "verified-synthesis",
        score: 28,
        verdict: "PROMOTE",
        synthesis: "synthesis/escaped.md",
        staged_skill: "skills/verified-skill/SKILL.md",
      }),
      "",
    ].join("\n"),
  );

  const snapshot = await server.loadAutoresearchSnapshot(fx.home);
  assert.equal(snapshot.rows[0].synthesisPath, null, "symlink escape must not reach the client");
  assert.equal(snapshot.rows[0].stagedSkillPath, await realpath(path.join(fx.skillDir, "SKILL.md")));
});

test("missing or malformed sources degrade to an unavailable empty snapshot", async () => {
  assert.ok(server);
  const home = await mkdtemp(path.join(tmpdir(), "cave-autoloop-missing-"));
  const snapshot = await server.loadAutoresearchSnapshot(home);
  assert.equal(snapshot.available, false);
  assert.deepEqual(snapshot.rows, []);
});

test("document reads are bounded to synthesis and staged-skill roots", async () => {
  assert.ok(server);
  const fx = await fixture();
  const synthesis = path.join(fx.synthesisDir, "verified-synthesis-2026-07-26.md");
  assert.equal(await server.readAutoresearchDocument(synthesis, fx.home), "# Verified synthesis\n");

  const outside = path.join(fx.home, "outside.md");
  await writeFile(outside, "# Outside\n");
  await assert.rejects(
    () => server.readAutoresearchDocument(outside, fx.home),
    /document path is not allowed/,
  );
});

test("file watching refreshes on ledger changes without a polling timer", async () => {
  assert.ok(server);
  const fx = await fixture();
  const changed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("watcher did not observe results.tsv")), 2_000);
    const stop = server!.watchAutoresearchSources(() => {
      clearTimeout(timeout);
      stop();
      resolve();
    }, fx.home);
  });

  // macOS FSEvents attaches asynchronously even though fs.watch returns
  // synchronously. Yield once so this proves invalidation rather than racing
  // native watcher registration.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await writeFile(
    path.join(fx.ledgerDir, "results.tsv"),
    "2026-07-26T10:00:00Z\tsynthesis\t83\tverified-synthesis\t0\t28\t+28\tPROMOTE\tmain\tUpdated\n",
  );
  await changed;
});
