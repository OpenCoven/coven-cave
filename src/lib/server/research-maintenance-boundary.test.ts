import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("backup recovery loads offline maintenance without ingestion workers", async () => {
  const result = await build({
    entryPoints: ["src/lib/server/backup-archive.ts"],
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll("\\", "/"));
  assert.ok(inputs.includes("src/lib/server/research-resource-maintenance.ts"));
  assert.ok(inputs.includes("src/lib/server/research-resource-recovery.ts"));
  assert.deepEqual(inputs.filter((file) =>
    /\/research-resource-(?:ingestion|fetch|extractors)\.ts$/.test(file)), [],
  "backup recovery must remain usable when the optional ingestion engine is absent");
});
