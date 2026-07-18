import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Windows has no POSIX login shell to source, so the interactive `-ilc` PATH
// probe (which falls back to /bin/zsh) always fails there. loginShellPath must
// short-circuit on win32 instead of attempting the doomed spawn — callers fall
// back to the Windows registry / system PATH.
for (const f of ["./coven-bin.ts", "./mobile-handoff.ts"]) {
  assert.match(
    read(f),
    /function loginShellPath\(\): string \| null \{[\s\S]*?process\.platform === "win32"\) return null/,
    `${f}: loginShellPath short-circuits on Windows`,
  );
}

console.log("login-shell-win32-guard passed");
