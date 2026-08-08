// @ts-nocheck
// Guard: every child process Cave launches must carry `windowsHide: true`.
//
// Why this is a build gate rather than a style preference. The Tauri shell
// starts the Node sidecar with CREATE_NO_WINDOW (see
// `src-tauri/src/sidecar_startup.rs`), so the server process running our route
// handlers has **no console attached**. Under Win32, `CreateProcess` on a
// console-subsystem child from a console-less parent *allocates a new console*
// — a real, visible conhost window — unless the child is given
// CREATE_NO_WINDOW as well. Node spells that flag `windowsHide: true`.
//
// So on Windows a plain `spawn("git", …)` pops a black terminal window over the
// app. The Research Desk made it impossible to miss: one mission iteration runs
// seven `familiar` steps and every one of them opened a window (cave-7jb).
//
// The option is a no-op off Windows, so there is no platform branch to get
// wrong — it belongs on every call, unconditionally.
//
// ⚠️ What it does NOT fix: a child launched through `shell: true`, or a
// `.cmd`/`.bat` npm shim executed by `cmd.exe`. That window belongs to the
// shell, not to the child. Resolve shims to a direct executable first with
// `covenLaunchCommandForBinary()` (`src/lib/coven-bin.ts`).
//
// This mirrors the Rust-side assertion in `src-tauri/release-runtime.test.mjs`,
// which pins `creation_flags(0x08000000)` on the sidecar launcher itself.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `exec`/`execFile`/`spawn` and their Sync/Async (promisified) aliases. The
// lookbehind keeps `RegExp.prototype.exec` — always called as `re.exec(` — out
// of the results.
const CHILD_PROCESS_CALL = /(?<![.\w$])(spawn|exec|execFile)(?:Sync|Async)?\s*\(/g;

/**
 * Call sites that forward an options object they do not own, so the flag is
 * asserted at the object's definition instead. Keep this list short and give
 * every entry a reason: an unexplained waiver is how the gate rots.
 */
const FORWARDS_CALLER_OPTIONS = new Map([
  [
    "lib/opencoven-tools-resolve.ts:30",
    "default NpmPrefixExecFile impl; the type requires windowsHide: true from callers",
  ],
  [
    "lib/opencoven-tools-status.ts:319",
    "default execLatestVersion impl; the type requires windowsHide: true from callers",
  ],
  [
    "lib/server/research-video-renderer.ts:186",
    "default SpawnProcess impl; the type requires windowsHide: true from callers",
  ],
]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Replace comment and string/template bodies with spaces. Byte offsets survive,
 * so line numbers stay accurate while prose mentioning `spawn(` cannot match.
 */
function blankNonCode(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (pair === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === "\\") k += 2;
        else if (source[k] === quote) break;
        else k += 1;
      }
      blank(i + 1, k);
      i = k + 1;
    } else i += 1;
  }
  return out.join("");
}

function matchingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `const <name> = { … }` / `const <name> = { … } as const` body, if any. */
function objectLiteralNamed(code: string, name: string): string | null {
  const declaration = new RegExp(`(?<![.\\w$])${name}\\s*(?::[^=]*)?=\\s*\\{`).exec(code);
  if (!declaration) return null;
  const open = code.indexOf("{", declaration.index);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

const offenders: string[] = [];
const unusedWaivers = new Set(FORWARDS_CALLER_OPTIONS.keys());

for (const file of sourceFiles(SRC_ROOT)) {
  const raw = readFileSync(file, "utf8");
  // Only files that actually import child_process launch anything. Without
  // this, unrelated local helpers named `spawn` (the canvas particle emitter in
  // `scry-glitch.tsx`, for one) would be flagged forever.
  if (!/from\s+["']node:child_process["']/.test(raw)) continue;

  const code = blankNonCode(raw);
  const relative = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
  CHILD_PROCESS_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHILD_PROCESS_CALL.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(code, open);
    if (close === -1) continue;
    const call = code.slice(open, close + 1);
    const line = raw.slice(0, match.index).split("\n").length;
    const site = `${relative}:${line}`;

    if (/windowsHide/.test(call)) continue;

    // The options object may be spread in (`{ ...spawnOptions, … }`) or passed
    // by name. Resolve one level: a same-file object literal carrying the flag
    // satisfies the guard.
    const referenced = Array.from(call.matchAll(/(?:\.\.\.|,\s*)([A-Za-z_$][\w$]*)\s*[,)]/g))
      .map((reference) => reference[1])
      .some((name) => /windowsHide/.test(objectLiteralNamed(code, name) ?? ""));
    if (referenced) continue;

    if (FORWARDS_CALLER_OPTIONS.has(site)) {
      unusedWaivers.delete(site);
      continue;
    }
    offenders.push(`${site}  ${call.slice(0, 70).replace(/\s+/g, " ")}`);
  }
}

assert.deepEqual(
  offenders,
  [],
  `child process launched without windowsHide: true — on Windows each of these opens a console window over the app (see the header of this file):\n  ${offenders.join("\n  ")}`,
);

assert.deepEqual(
  Array.from(unusedWaivers),
  [],
  "FORWARDS_CALLER_OPTIONS lists call sites that no longer exist or no longer need a waiver — delete them",
);

// The scanner must actually be looking at something; an empty sweep (a moved
// source root, a broken regex) would pass the assertions above vacuously.
assert.ok(
  sourceFiles(SRC_ROOT).some((file) =>
    /from\s+["']node:child_process["']/.test(readFileSync(file, "utf8")),
  ),
  "no child_process importers found under src/ — the guard is scanning the wrong tree",
);
