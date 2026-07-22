// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./opencode-bin.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const isWsl = process\.platform === "linux" &&\s*Boolean\(process\.env\.WSL_DISTRO_NAME \|\| process\.env\.WSL_INTEROP\);[\s\S]*?if \(isWsl \|\| \(process\.platform !== "win32" && !env\.XDG_RUNTIME_DIR\)\) \{\s*env\.XDG_RUNTIME_DIR = "\/tmp";/,
  "WSL OpenCode spawns replace a stale inherited XDG runtime directory with /tmp",
);

console.log("opencode-bin.test.ts: ok");
