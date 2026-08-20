import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

assert.match(
  nextConfig,
  /turbopackFileSystemCacheForDev:\s*false/,
  "dev must keep Turbopack's persistent filesystem cache disabled so multi-gigabyte compaction cannot stall the PostCSS worker",
);

console.log("turbopack-dev-cache.test.mjs: ok");
