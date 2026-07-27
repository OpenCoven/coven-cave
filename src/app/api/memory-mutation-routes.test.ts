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
for (const [file, fn] of [["delete", "archiveMemoryFile"], ["restore", "restoreMemoryFile"], ["purge", "purgeMemoryTrash"]] as const) {
  const src = await readFile(new URL(`./memory/${file}/route.ts`, import.meta.url), "utf8");
  assert.match(src, /export async function POST/, `${file} route is POST`);
  assert.match(src, new RegExp(fn), `${file} route calls ${fn}`);
}

const home = await mkdtemp(path.join(tmpdir(), "memory-mutation-api-"));
const previousHome = process.env.HOME;
process.env.HOME = home;
try {
  const canonicalFile = path.join(home, ".coven", "memory", "sage", "canonical.md");
  const workspaceFile = path.join(
    home,
    ".coven",
    "workspaces",
    "familiars",
    "sage",
    "memory",
    "note.md",
  );
  await mkdir(path.dirname(canonicalFile), { recursive: true });
  await mkdir(path.dirname(workspaceFile), { recursive: true });
  await writeFile(canonicalFile, "canonical API fixture", "utf8");
  await writeFile(workspaceFile, "workspace API fixture", "utf8");

  const [{ PUT }, { POST: archive }] = await Promise.all([
    import("./memory/file/route.ts"),
    import("./memory/delete/route.ts"),
  ]);
  const canonicalWrite = await PUT(
    new Request("http://localhost/api/memory/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: canonicalFile, text: "mutated" }),
    }),
  );
  assert.equal(canonicalWrite.status, 403, "canonical memory writes fail closed at the API");

  const canonicalArchive = await archive(
    new Request("http://localhost/api/memory/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: canonicalFile }),
    }),
  );
  assert.equal(canonicalArchive.status, 403, "canonical memory archives fail closed at the API");
  assert.equal(await readFile(canonicalFile, "utf8"), "canonical API fixture");

  const workspaceArchive = await archive(
    new Request("http://localhost/api/memory/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspaceFile }),
    }),
  );
  assert.equal(workspaceArchive.status, 200, "Coven familiar workspace archives remain allowed");
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(home, { recursive: true, force: true });
}

console.log("memory-mutation-routes.test: ok");
