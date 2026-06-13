// Module-resolution hook that teaches the bare `node --experimental-strip-types`
// test runner about the project's `@/*` → `./src/*` path alias (see tsconfig.json
// "paths"). Node doesn't read tsconfig, so colocated tests whose module graph
// imports `@/...` (e.g. cave-config.ts → "@/lib/familiar-runtime") fail with
// ERR_MODULE_NOT_FOUND. Register this via scripts/test-alias-register.mjs:
//
//   node --experimental-strip-types --import ./scripts/test-alias-register.mjs <test>
//
// It only rewrites `@/` specifiers; everything else falls through unchanged.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// repo/src/ — this file lives in repo/scripts/.
const SRC_BASE = new URL("../src/", import.meta.url);

// Try the bare path first, then the extensions/index forms the TS resolver
// would accept for an extensionless import.
const SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = new URL(specifier.slice(2), SRC_BASE); // @/lib/x → repo/src/lib/x
    for (const suffix of SUFFIXES) {
      const candidate = new URL(target.href + suffix);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    // Nothing matched — hand the bare path to the default resolver so its
    // error names the missing file rather than masking it.
    return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
}
