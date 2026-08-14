import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

assert.match(
  source,
  /ensureAdapterManifestScaffold/,
  "config PATCH should use the shared adapter scaffold writer when harness bindings change",
);

assert.match(
  source,
  /import \{ covenWorkspaceRoot \} from "@\/lib\/coven-paths"/,
  "config GET should source the workspace root from the shared Cave path helper",
);

assert.match(
  source,
  /const config = await loadConfig\(\);[\s\S]*const workspacePath = covenWorkspaceRoot\(\);[\s\S]*return NextResponse\.json\(\{ ok: true, config, workspacePath \}\);/,
  "config GET should return workspacePath alongside the config payload",
);

assert.match(
  source,
  /const defaults = body\.defaults[\s\S]*defaultsHarness/,
  "config PATCH should inspect defaults.harness for runtime switches",
);

assert.match(
  source,
  /const familiars = body\.familiars[\s\S]*for \(const patch of Object\.values\(familiars\)\)[\s\S]*patchHarness/,
  "config PATCH should inspect familiar harness overrides for runtime switches",
);

assert.match(
  source,
  /await scaffoldAdapterManifestsFromPatch\(body\);[\s\S]*saveConfig\(body as Parameters<typeof saveConfig>\[0\]\)/,
  "config PATCH should scaffold required adapter manifests before saving config",
);

console.log("config route.test.ts: ok");
