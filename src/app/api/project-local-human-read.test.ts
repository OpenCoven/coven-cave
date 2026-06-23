// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helper = await readFile(
  new URL("../../lib/server/project-permission-requests.ts", import.meta.url),
  "utf8",
);

// The helper allows the local human (loopback) to use read-only surfaces with
// no familiar, gated by isLocalOrigin + a read-surface allowlist.
assert.match(helper, /import \{ isLocalOrigin \} from "@\/lib\/server\/local-origin"/, "imports isLocalOrigin");
assert.match(
  helper,
  /LOCAL_HUMAN_READ_SURFACES: ReadonlySet<ProjectPermissionSurface> = new Set\(\[\s*"file-browse",\s*"file-read",\s*"project-api",\s*\]\)/,
  "defines the read-only surface allowlist",
);
assert.doesNotMatch(helper, /LOCAL_HUMAN_READ_SURFACES[\s\S]*"file-write"/, "writes are NOT in the local-human allowlist");
assert.match(
  helper,
  /if \(args\.request && isLocalOrigin\(args\.request\) && LOCAL_HUMAN_READ_SURFACES\.has\(surface\)\) \{\s*return;/,
  "allows loopback no-familiar reads of read surfaces",
);
assert.match(helper, /throw new ProjectAccessDeniedError\("missing familiarId for project access"\)/, "still throws for non-local / write");

// Every read route forwards the request so the loopback check can run.
for (const rel of [
  "./project-tree/route.ts",
  "./project-file/route.ts",
  "./project/files/route.ts",
  "./project/search/route.ts",
]) {
  const src = await readFile(new URL(rel, import.meta.url), "utf8");
  assert.match(src, /request: req,/, `${rel} should forward the request to assertProjectApiAccess`);
}

console.log("project-local-human-read.test.ts: ok");
