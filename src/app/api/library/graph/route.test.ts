// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /import\s+\{\s*resolveSecret\s*\}\s+from "@\/lib\/vault"/,
  "library graph route should use the existing 1Password vault resolver",
);

for (const key of [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MOONSHOT_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
]) {
  assert.match(
    route,
    new RegExp(`GRAPHIFY_LLM_ENV_KEYS[\\s\\S]*"${key}"`),
    `graphify env should consider ${key}`,
  );
}

assert.match(
  route,
  /for \(const key of GRAPHIFY_LLM_ENV_KEYS\) \{[\s\S]*?const value = resolveSecret\(key\);[\s\S]*?env\[key\] = value;/,
  "graphify env should inject vault-resolved provider keys into the child process env",
);

assert.match(
  route,
  /env:\s*buildGraphifyEnv\(\)/,
  "graphify child process should receive the vault-hydrated env",
);

assert.match(
  route,
  /function makeGraphRunSnapshot\(/,
  "library graph route should create persisted run snapshots",
);

assert.match(
  route,
  /function withGraphRunSnapshots\(/,
  "library graph route should backfill snapshots for legacy saved graph files",
);

assert.match(
  route,
  /status:\s*"started"/,
  "Graphify POST should record a started snapshot before extraction",
);

assert.match(
  route,
  /status:\s*"completed"/,
  "Graphify POST should record a completed snapshot after reading graph output",
);

assert.match(
  route,
  /status:\s*"failed"/,
  "Graphify POST should record a failed snapshot when extraction fails",
);

assert.match(
  route,
  /snapshots,\s*\n\s*graphJson/,
  "GraphifyResult should persist snapshots with the graph payload",
);

console.log("library graph route vault env test passed");
