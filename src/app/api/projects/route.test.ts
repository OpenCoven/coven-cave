// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const itemRoute = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const seedRoute = readFileSync(new URL("./seed/route.ts", import.meta.url), "utf8");
const securitySource = readFileSync(new URL("../../../lib/server/api-security.ts", import.meta.url), "utf8");
const guidanceModuleUrl = new URL("../../../lib/project-root-guidance.ts", import.meta.url);
const localRequestModuleUrl = new URL("../../../lib/project-errors.ts", import.meta.url);
const guidanceSource = readFileSync(guidanceModuleUrl, "utf8");
const {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_WORKSPACE_HELP,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} = await import(guidanceModuleUrl.href);
const { LOCAL_REQUEST_REQUIRED_CODE } = await import(localRequestModuleUrl.href);

assert.match(listRoute, /seedDefaultProjectsIfEmpty/, "GET /api/projects should seed defaults before listing");
assert.doesNotMatch(
  listRoute,
  /bootstrapConfiguredFamiliarProjectGrants/,
  "GET /api/projects must not auto-grant configured familiars before familiar-scoped filtering",
);
assert.match(listRoute, /export async function GET\(req: Request\)/, "projects route should expose GET");
assert.match(listRoute, /searchParams\.get\("familiarId"\)/, "GET /api/projects should accept familiar-scoped listing");
assert.match(listRoute, /isValidFamiliarId\(familiarId\)/, "GET /api/projects should validate familiar id before scoping");
assert.match(
  listRoute,
  /listAccessibleProjects\(projects, familiarId\)/,
  "GET /api/projects should resolve the familiar's effective access level server-side",
);
assert.match(
  listRoute,
  /validateCaveProjectRoot\(project\.root\)/,
  "familiar-scoped project choices should omit roots that no longer resolve to directories",
);
assert.match(
  listRoute,
  /\{\s*\.\.\.project,\s*access\s*\}/,
  "familiar-scoped project choices should carry their effective Read or Full access level",
);
assert.doesNotMatch(
  listRoute,
  /filterProjectsForFamiliar\(projects, familiarId\)/,
  "the familiar-scoped route must not discard effective access metadata",
);
assert.match(listRoute, /export async function POST\(req: Request\)/, "projects route should expose POST");
assert.equal(LOCAL_REQUEST_REQUIRED_CODE, "local_request_required", "local-only project mutations should expose a stable error code");
assert.match(
  securitySource,
  /code:\s*LOCAL_REQUEST_REQUIRED_CODE[\s\S]*error:\s*"forbidden"/,
  "local-only rejection should preserve the legacy error and add the stable code",
);
assert.match(listRoute, /name and root are required/, "POST /api/projects should validate required fields");
// cave-8e7q: the display name is presentation text, never a connection
// identifier — identity is id + root. Trimming the ends is the ONLY normalizing
// allowed, so interior spaces in a name like `My Project Two` reach the store
// intact. A slugify/tokenize step added here is what originally mangled it.
assert.match(
  listRoute,
  /const\s+name\s*=\s*String\(body\.name\s*\?\?\s*""\)\.trim\(\);/,
  "POST /api/projects should store the display name with only its ends trimmed",
);
assert.match(listRoute, /isAllowedNewProjectRoot\(root\)/, "POST /api/projects should validate roots before persisting them");
assert.equal(
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE",
  "project root guidance should expose a stable outside-workspace code",
);
assert.equal(
  PROJECT_ROOT_WORKSPACE_HELP,
  "Project folders can live anywhere on this computer — any folder works except your home folder itself or the top of a drive.",
  "project root guidance should expose stable workspace help text",
);
assert.equal(
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
  "Choose a specific folder for this project — your home folder itself or the top of a drive can't be a project root.",
  "project root guidance should expose stable outside-workspace error text",
);
assert.match(
  guidanceSource,
  /export const PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE/,
  "project root guidance module should define the shared outside-workspace code",
);
assert.match(
  listRoute,
  /from "@\/lib\/project-root-guidance"/,
  "POST /api/projects should import shared project-root guidance",
);
assert.match(
  listRoute,
  /code:\s*PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE[\s\S]*error:\s*PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR/,
  "POST /api/projects should return the shared outside-workspace contract",
);
assert.match(listRoute, /status:\s*403/, "POST /api/projects should reject unsafe roots with 403");
assert.match(listRoute, /validateCaveProjectRoot/, "POST /api/projects should require existing directory roots before persisting them");
assert.match(listRoute, /status:\s*201/, "POST /api/projects should return 201 when creating");
assert.match(
  listRoute,
  /from "@\/lib\/github-repo-link"/,
  "POST /api/projects should import the shared GitHub repo-link normalizer",
);
assert.match(
  listRoute,
  /normalizeGitHubRepoUrl\(body\.repoUrl\)/,
  "POST /api/projects should normalize a provided repoUrl instead of storing raw input",
);
assert.match(
  listRoute,
  /repoUrl must be a GitHub repository link/,
  "POST /api/projects should reject non-GitHub repoUrl values with an actionable error",
);
assert.match(
  listRoute,
  /export async function POST\(req: Request\)\s*\{\s*const denied = rejectNonLocalRequest\(req\);/,
  "POST /api/projects must enforce loopback before registering \$HOME-scoped roots",
);
assert.doesNotMatch(
  listRoute,
  /export async function GET\(req: Request\)\s*\{\s*const denied = rejectNonLocalRequest/,
  "GET /api/projects stays reachable over the tailnet like its read-only siblings (familiars/board/sessions)",
);

assert.match(itemRoute, /export async function PUT/, "project item route should expose PUT");
assert.match(itemRoute, /export async function DELETE/, "project item route should expose DELETE");
assert.match(itemRoute, /isAllowedNewProjectRoot\(trimmed\)/, "PUT /api/projects/[id] should validate root patches before persisting them");
assert.match(
  itemRoute,
  /from "@\/lib\/project-root-guidance"/,
  "PUT /api/projects/\\[id\\] should import shared project-root guidance",
);
assert.match(
  itemRoute,
  /code:\s*PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE[\s\S]*error:\s*PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR/,
  "PUT /api/projects/[id] should return the shared outside-workspace contract",
);
assert.match(itemRoute, /status:\s*403/, "PUT /api/projects/[id] should reject unsafe roots with 403");
assert.match(itemRoute, /validateCaveProjectRoot/, "PUT /api/projects/[id] should require existing directory roots before persisting them");
assert.match(itemRoute, /nothing to update/, "PUT /api/projects/[id] should reject empty patches");
assert.match(
  itemRoute,
  /from "@\/lib\/github-repo-link"/,
  "PUT /api/projects/[id] should import the shared GitHub repo-link normalizer",
);
assert.match(
  itemRoute,
  /normalizeGitHubRepoUrl\(trimmed\)/,
  "PUT /api/projects/[id] should normalize repoUrl patches instead of storing raw input",
);
assert.match(
  itemRoute,
  /repoUrl must be a GitHub repository link/,
  "PUT /api/projects/[id] should reject non-GitHub repoUrl values with an actionable error",
);
assert.match(
  itemRoute,
  /body\.repoUrl === null[\s\S]{0,80}patch\.repoUrl = null/,
  "PUT /api/projects/[id] should accept null to unlink the repository",
);
assert.match(itemRoute, /not found/, "project item route should return not-found errors");
assert.match(itemRoute, /rejectNonLocalRequest/, "project item route must enforce loopback before mutating project roots");
// cave-eonxy: the atomic helper deletes the registry row and cascades grants
// under one authorization lock. A missing row with permission residue is still
// successful cleanup; only an entirely unknown id is a 404.
assert.match(
  itemRoute,
  /import\s*\{\s*deleteProjectAndRevokeGrants\s*\}\s*from\s*"@\/lib\/project-permissions"/,
  "DELETE /api/projects/[id] must use the atomic project-and-grants delete helper",
);
assert.match(
  itemRoute,
  /const\s+result\s*=\s*await\s+deleteProjectAndRevokeGrants\(id\)/,
  "DELETE /api/projects/[id] must await atomic deletion and grant revocation",
);
assert.doesNotMatch(
  itemRoute,
  /revokeAllGrantsForProject/,
  "DELETE /api/projects/[id] must not split atomic deletion into a separate grant-revocation call",
);
assert.match(
  itemRoute,
  /!result\.deleted\s*&&\s*result\.cleaned\s*===\s*null/,
  "DELETE /api/projects/[id] 404s only when the atomic helper found neither a project nor grant residue",
);
assert.match(
  itemRoute,
  /return\s+NextResponse\.json\(\{\s*ok:\s*true,\s*cleaned:\s*result\.cleaned\s*\}\)/,
  "DELETE /api/projects/[id] must report successful deletion or residue revocation with its cleanup result",
);
{
  const deleteStart = itemRoute.indexOf("export async function DELETE");
  assert.ok(deleteStart >= 0, "DELETE handler must exist");
  const deleteFn = itemRoute.slice(deleteStart);
  const deleteAndRevokeAt = deleteFn.indexOf("deleteProjectAndRevokeGrants");
  const notFoundAt = deleteFn.indexOf('error: "not found"');
  const successAt = deleteFn.indexOf("ok: true, cleaned: result.cleaned");
  assert.ok(
    deleteAndRevokeAt >= 0 && notFoundAt >= 0 && successAt >= 0,
    "DELETE should contain atomic-delete, not-found, and success branches",
  );
  assert.ok(
    deleteAndRevokeAt < notFoundAt && deleteAndRevokeAt < successAt,
    "DELETE must resolve the atomic helper before choosing a 404 or success response (cave-eonxy)",
  );
  assert.doesNotMatch(
    deleteFn,
    /deleteProjectAndRevokeGrants\(id\)[\s\S]*?catch\s*\(/,
    "atomic deletion failures must propagate instead of being misreported as a 404 or successful cleanup",
  );
}

assert.match(seedRoute, /seedDefaultProjectsIfEmpty/, "seed route should invoke default seeding");
assert.match(seedRoute, /export async function POST\(\)/, "seed route should expose POST only");

console.log("projects route.test.ts: ok");
