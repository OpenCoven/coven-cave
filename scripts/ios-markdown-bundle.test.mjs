import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["apps/ios/markdown/entry.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari16",
  minify: true,
  write: false,
  metafile: true,
  legalComments: "none",
});

const bytes = result.outputFiles[0].contents.byteLength;
assert.ok(
  bytes < 512 * 1024,
  `Every chat renderer loads the core bundle: ${bytes} bytes exceeds the 512 KiB startup budget`,
);
assert.deepEqual(
  Object.keys(result.metafile.inputs).filter((name) => /node_modules\/(?:\.pnpm\/)?(?:@create-markdown\/preview-mermaid|mermaid)[/@]/.test(name)),
  [],
  "Diagram-only dependencies must not be parsed when opening ordinary chat messages",
);

console.log(`ios-markdown-bundle.test.mjs: ok (${bytes} startup bytes)`);
