import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// These host contracts must remain usable after the optional engine is removed.
// Bundling follows transitive imports, so moving an engine dependency behind a
// helper cannot silently reintroduce it into core project/GitHub operations.
const retainedContracts = new Set([
  "src/lib/server/research-runtime-contract.ts",
  "src/lib/server/research-session-authority.ts",
]);

test("core GitHub and project contracts do not depend on the Research engine", async () => {
  const result = await build({
    entryPoints: [
      "src/lib/github-review.ts",
      "src/lib/server/project-paths.ts",
      "src/lib/server/research-runtime-contract.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: "unused-boundary-test-output",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll("\\", "/"));
  const engineInputs = inputs.filter((file) =>
    /(?:^|\/)research[^/]*\//.test(file) ||
    /(?:^|\/)research[^/]*\.tsx?$/.test(file) && !retainedContracts.has(file),
  );
  assert.deepEqual(engineInputs, [], "core contracts pulled in optional Research implementation");
  assert.ok(inputs.includes("src/lib/server/research-runtime-contract.ts"));
  assert.ok(inputs.includes("src/lib/github-object-sha.ts"));
});
