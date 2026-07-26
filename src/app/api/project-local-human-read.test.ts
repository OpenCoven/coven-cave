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
const localHumanSet = helper.match(
  /LOCAL_HUMAN_READ_SURFACES: ReadonlySet<ProjectPermissionSurface> = new Set\(\[[\s\S]*?\]\)/,
)?.[0] ?? "";
assert.ok(localHumanSet, "found the local-human allowlist set literal");
assert.doesNotMatch(localHumanSet, /"file-write"/, "writes are NOT in the local-human allowlist");

// The human-read predicate covers BOTH the loopback desktop (read surfaces) and
// the phone (mobile surface, GET only — writes/POST fall through to the familiar
// requirement).
assert.match(
  helper,
  /function isHumanRead\(req: Request \| undefined, surface: ProjectPermissionSurface\)/,
  "defines an isHumanRead predicate",
);
assert.match(
  helper,
  /if \(isLocalOrigin\(req\) && LOCAL_HUMAN_READ_SURFACES\.has\(surface\)\) return true;/,
  "loopback desktop reads of read surfaces count as a human read",
);
assert.match(
  helper,
  /if \(surface === "mobile" && \(req\.method \?\? "GET"\)\.toUpperCase\(\) === "GET"\) return true;/,
  "a mobile GET counts as a human read; a mobile POST (write) does not",
);
// Registered-project reads use the predicate, and still throw without it.
assert.match(helper, /if \(isHumanRead\(args\.request, surface\)\) \{\s*return;/, "registered-project reads gate on isHumanRead");
assert.match(helper, /throw new ProjectAccessDeniedError\("missing familiarId for project access"\)/, "still throws for non-human / write");

// The paired phone may WRITE without a familiar only behind the desktop
// opt-in (allowMobileFileWrites), only on the file-write surface, and only
// for verified-mobile requests. Familiar-scoped writes keep grant
// enforcement; the shell surface never takes this branch.
assert.match(
  helper,
  /async function isHumanMobileWrite\([\s\S]*?if \(surface !== "file-write"\) return false;[\s\S]*?MOBILE_ACCESS_HEADER\) !== "1"\) return false;[\s\S]*?allowMobileFileWrites[\s\S]*?\}/,
  "human mobile writes are limited to the file-write surface on proxy-verified phone requests",
);
assert.match(
  helper,
  /if \(await isHumanMobileWrite\(args\.request, surface\)\) \{\s*return;/,
  "registered-project no-familiar writes consult the opt-in mobile-write predicate",
);
assert.doesNotMatch(
  helper,
  /isHumanMobileWrite\(args\.request, surface\)[\s\S]*?resolveAllowedProjectPath/,
  "unregistered paths (familiar workspaces, cwd) must stay read-only from the phone",
);

// A familiar's own workspace isn't a *registered* project, but the human may
// still browse any path the traversal guard allows (resolveAllowedProjectPath).
// The Code tab attaches the owning familiar's id as context, so the exemption
// must NOT require its absence — isHumanRead is the gate (read surfaces only).
assert.match(
  helper,
  /import \{ resolveAllowedProjectPath \} from "@\/lib\/server\/project-paths"/,
  "imports the traversal-guard resolver",
);
assert.match(
  helper,
  /if \(isHumanRead\(args\.request, surface\) && resolveAllowedProjectPath\(requestedPath\)\) \{\s*return;/,
  "human reads of an unregistered-but-allowed path (e.g. a familiar workspace) are permitted, even with a familiar id attached",
);

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

// The save handler must forward it too — the human-mobile file-write branch
// reads the proxy marker off the request, and a GET-only match masked its
// omission once already (review of #3652).
{
  const src = await readFile(new URL("./project-file/route.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /surface: projectPermissionSurfaceForRequest\(req, "file-write"\),\s*request: req,/,
    "project-file POST should forward the request so mobile file writes can be authorized",
  );
}

console.log("project-local-human-read.test.ts: ok");
