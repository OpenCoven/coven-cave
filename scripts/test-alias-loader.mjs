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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// repo/src/ — this file lives in repo/scripts/.
const SRC_BASE = new URL("../src/", import.meta.url);
const ROOT_PACKAGE_JSON = new URL("../package.json", import.meta.url).href;
const TRANSFORM_ROOTS = [
  SRC_BASE,
  new URL("../scripts/", import.meta.url),
  new URL("../tests/", import.meta.url),
].map(fileURLToPath);

// Try the bare path first, then the extensions/index forms the TS resolver
// would accept for an extensionless import.
const SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  // Next 16 ships the server entry as server.js. Framework source continues to
  // import the public `next/server` API, but Node 24's ESM resolver no longer
  // performs that extension fallback when a route-level test imports the real
  // route graph through this loader.
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
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
  // Extensionless relative imports (e.g. slash-commands.ts → "./keyboard-shortcuts").
  // Node's default resolver requires the extension; TS does not. Resolve the way
  // the TS resolver would, but only when the bare specifier doesn't already exist.
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    !/\.[mc]?[jt]sx?$/.test(specifier)
  ) {
    const target = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(target))) {
      for (const suffix of SUFFIXES.slice(1)) {
        const candidate = new URL(target.href + suffix);
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}

// Node's type stripper intentionally does not transform TSX. A small set of
// behavioral component tests uses this alias hook and imports real `.tsx`
// modules, so transpile only those modules through the repo-pinned esbuild.
// Plain `.ts` keeps using Node's native strip-types path.
function isRepoOwnedTransformUrl(url) {
  if (!url.startsWith("file:")) return false;
  const filePath = fileURLToPath(url);
  return TRANSFORM_ROOTS.some((root) => {
    const relative = path.relative(root, filePath);
    return !path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`);
  });
}

export async function load(url, context, nextLoad) {
  if (
    (isRepoOwnedTransformUrl(url) || url === ROOT_PACKAGE_JSON) &&
    url.endsWith(".json")
  ) {
    const parsed = JSON.parse(await readFile(new URL(url), "utf8"));
    return {
      format: "module",
      source: `export default ${JSON.stringify(parsed)};`,
      shortCircuit: true,
    };
  }
  if (isRepoOwnedTransformUrl(url) && url.endsWith(".tsx")) {
    const [{ transform }, source] = await Promise.all([
      import("esbuild"),
      readFile(new URL(url), "utf8"),
    ]);
    const result = await transform(source, {
      loader: "tsx",
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      sourcefile: fileURLToPath(url),
      sourcemap: "inline",
    });
    return {
      format: "module",
      source: result.code,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
