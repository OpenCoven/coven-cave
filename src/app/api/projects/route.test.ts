// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const itemRoute = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const seedRoute = readFileSync(new URL("./seed/route.ts", import.meta.url), "utf8");
const guidanceModuleUrl = new URL("../../../lib/project-root-guidance.ts", import.meta.url);
const guidanceSource = readFileSync(guidanceModuleUrl, "utf8");
const {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_WORKSPACE_HELP,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} = await import(guidanceModuleUrl.href);

assert.match(listRoute, /seedDefaultProjectsIfEmpty/, "GET /api/projects should seed defaults before listing");
assert.doesNotMatch(
  listRoute,
  /bootstrapConfiguredFamiliarProjectGrants/,
  "GET /api/projects must not auto-grant configured familiars before familiar-scoped filtering",
);
assert.match(listRoute, /export async function GET\(req: Request\)/, "projects route should expose GET");
assert.match(listRoute, /searchParams\.get\("familiarId"\)/, "GET /api/projects should accept familiar-scoped listing");
assert.match(listRoute, /isValidFamiliarId\(familiarId\)/, "GET /api/projects should validate familiar id before scoping");
assert.match(listRoute, /filterProjectsForFamiliar\(projects, familiarId\)/, "GET /api/projects should filter projects server-side for familiars");
assert.match(listRoute, /export async function POST\(req: Request\)/, "projects route should expose POST");
assert.match(listRoute, /name and root are required/, "POST /api/projects should validate required fields");
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

assert.match(seedRoute, /seedDefaultProjectsIfEmpty/, "seed route should invoke default seeding");
assert.match(seedRoute, /export async function POST\(\)/, "seed route should expose POST only");

console.log("projects route.test.ts: ok");
