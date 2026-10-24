import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

// Exercise the production host export used by the published Research runner.
// The child has an isolated home and a daemon client that always refuses.
// Restoring the TOML re-export must make each case fail, even with valid TOML.
for (const operation of ["get", "create", "pause"] as const) {
  test(`Research ${operation} refuses an unavailable daemon without touching legacy definitions`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cave-research-boundary-"));
    try {
      const legacy = path.join(root, ".codex", "automations");
      const source = path.join(legacy, "existing", "automation.toml");
      await mkdir(path.dirname(source), { recursive: true });
      const original = 'version = "1"\nid = "existing"\nname = "Existing"\nstatus = "ACTIVE"\nrrule = "RRULE:FREQ=DAILY;BYHOUR=9"\nprompt = "preserve source bytes"\n';
      await writeFile(source, original);
      const entry = path.resolve("src/lib/research-host/lib/codex-automations.ts");
      const output = path.join(root, "probe.mjs");
      await build({
        stdin: {
          contents: `import * as host from ${JSON.stringify(entry)};
            const input = { name: "New", rrule: "RRULE:FREQ=DAILY;BYHOUR=9", prompt: "test", cwds: ["/fixture/mission"], tags: ["research-mission:mission-1"], familiars: ["sage"], model: "", reasoningEffort: "", executionEnvironment: "", skillPath: null };
            const context = { missionId: "mission-1", automationId: "existing", adoptionKey: "research-command-1", expectedRevision: 1 };
            try {
              const result = await (${JSON.stringify(operation)} === "get" ? host.getCodexAutomation("existing") : ${JSON.stringify(operation)} === "create" ? host.createCodexAutomation(input, context) : host.updateCodexAutomation("existing", { status: "PAUSED" }, context));
              process.stdout.write(JSON.stringify({ kind: "returned", result }));
            } catch (error) { process.stdout.write(JSON.stringify({ kind: "refused", code: error.code })); }`,
          resolveDir: process.cwd(),
          loader: "ts",
        },
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        logLevel: "silent",
        plugins: [{
          name: "unavailable-daemon",
          setup(builder) {
            builder.onResolve({ filter: /coven-automations-sdk(?:\.ts)?$/ }, () => ({ path: "daemon", namespace: "unavailable" }));
            builder.onLoad({ filter: /.*/, namespace: "unavailable" }, () => ({
              contents: `const unavailable = async () => { throw Object.assign(new Error("daemon unavailable"), { code: "unavailable" }); }; export const createAutomationReadClient = () => new Proxy({}, { get: () => unavailable }); export const createAutomationCommandClient = createAutomationReadClient;`,
              loader: "js",
            }));
          },
        }],
      });
      const child = spawnSync(process.execPath, [output], {
        env: { ...process.env, HOME: root, COVEN_HOME: path.join(root, "coven") },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(child.status, 0, child.stderr);
      const outcome = JSON.parse(child.stdout);
      const bytes = await readFile(source, "utf8");
      const ids = await readdir(legacy);
      assert.deepEqual({ kind: outcome.kind, code: outcome.code, bytes, ids }, { kind: "refused", code: "unavailable", bytes: original, ids: ["existing"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
