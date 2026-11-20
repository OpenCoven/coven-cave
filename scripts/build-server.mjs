import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./direct-run.mjs";

// Tests inspect this same bundle in memory; builds write the deployable artifact.
export function buildServer({ write = true } = {}) {
  return build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: ["server.ts"],
    bundle: true,
    packages: "external",
    alias: { yaml: "./node_modules/yaml/dist/index.js" },
    banner: {
      js: "import { createRequire as __covenCreateRequire } from 'node:module'; const require = __covenCreateRequire(import.meta.url);",
    },
    platform: "node",
    target: "node24",
    outfile: "server.mjs",
    format: "esm",
    write,
  });
}

if (isDirectRun(import.meta.url)) await buildServer();
