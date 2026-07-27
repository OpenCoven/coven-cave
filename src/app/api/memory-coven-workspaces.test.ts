import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});
const source = await readFile(new URL("./memory/route.ts", import.meta.url), "utf8");
const inventory = await readFile(
  new URL("../../lib/server/memory-file-inventory.ts", import.meta.url),
  "utf8",
);
assert.match(source, /listMemoryFileEntries/, "route returns the shared memory file inventory");
assert.match(
  inventory,
  /collectCovenFamiliarWorkspaces/,
  "memory inventory surfaces coven familiar workspace memory",
);
assert.match(inventory, /workspaces.*familiars|"familiars"/, "scans the coven familiars dir");

const home = await mkdtemp(path.join(tmpdir(), "memory-api-boundary-"));
const previousHome = process.env.HOME;
process.env.HOME = home;
try {
  const canonicalFile = path.join(home, ".coven", "memory", "sage", "canonical.md");
  await mkdir(path.dirname(canonicalFile), { recursive: true });
  await writeFile(canonicalFile, "canonical API fixture", "utf8");
  const { GET: getMemoryFile } = await import("./memory/file/route.ts");

  for (const suffix of ["", "&stat=1"]) {
    const request = new Request(
      `http://localhost/api/memory/file?path=${encodeURIComponent(canonicalFile)}${suffix}`,
    );
    const response = await getMemoryFile(request);
    assert.equal(
      response.status,
      403,
      `canonical memory ${suffix ? "stat" : "read"} requests fail closed`,
    );
    assert.deepEqual(await response.json(), { ok: false, error: "path not allowed" });
  }
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(home, { recursive: true, force: true });
}

console.log("memory-coven-workspaces.test: ok");
