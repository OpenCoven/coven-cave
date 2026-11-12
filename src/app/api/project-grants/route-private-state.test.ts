// @ts-nocheck
// #6451: the grant routes refuse new Write access to a folder that holds
// Cave's private state with 409 cave_private_state_write, keep Read and
// unrelated edits working, and list such projects for the grant screens.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = await realpath(await mkdtemp(path.join(tmpdir(), "cave-private-state-routes-")));
const caveHomeForTest = path.join(tmp, "coven", "cave");
Object.assign(process.env, {
  HOME: tmp,
  COVEN_HOME: path.join(tmp, "coven"),
  COVEN_CAVE_HOME: caveHomeForTest,
  CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(tmp, "permissions.json"),
  CAVE_PERMISSION_CONFIG_PATH_OVERRIDE: path.join(tmp, "permission-config.json"),
  CAVE_PROJECTS_PATH_OVERRIDE: path.join(tmp, "projects.json"),
  CAVE_SUPREME_FAMILIAR_ID: "supreme",
});
delete process.env.COVEN_CAVE_AUTH_TOKEN;

try {
  await mkdir(path.join(tmp, "app"), { recursive: true });
  await mkdir(caveHomeForTest, { recursive: true });
  const projects = [
    { id: "home", name: "Coven home", root: path.join(tmp, "coven"), createdAt: "now", updatedAt: "now" },
    { id: "app", name: "App", root: path.join(tmp, "app"), createdAt: "now", updatedAt: "now" },
  ];
  await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify({ version: 1, projects }));

  const grants = await import("./route.ts");
  const groups = await import("../access-groups/route.ts");
  const group = await import("../access-groups/[id]/route.ts");
  const proposals = await import("../grant-proposals/route.ts");
  const proposal = await import("../grant-proposals/[id]/route.ts");

  const request = (method, body) => new Request("http://localhost/api", {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const params = (id) => ({ params: Promise.resolve({ id }) });
  const refused = async (responsePromise, label) => {
    const response = await responsePromise;
    const json = await response.json();
    assert.equal(response.status, 409, `${label}: ${JSON.stringify(json)}`);
    assert.equal(json.ok, false);
    assert.equal(json.code, "cave_private_state_write", label);
    assert.equal(json.projectId, "home", label);
    assert.match(json.error, /Cave’s private state/, label);
    return json;
  };
  const ok = async (responsePromise, label) => {
    const response = await responsePromise;
    const json = await response.json();
    assert.ok(response.status < 300, `${label}: ${response.status} ${JSON.stringify(json)}`);
    return json;
  };

  // The listing marks the project the grant screens must flag.
  const listing = await ok(grants.GET(), "listing");
  assert.deepEqual(listing.privateStateProjectIds, ["home"]);

  // Access groups: new Write refused, Read and unrelated edits pass.
  await refused(groups.POST(request("POST", { name: "Builders", memberFamiliarIds: ["nova"], projectGrants: [{ projectId: "home", access: "write" }] })), "create with Write");
  const created = await ok(groups.POST(request("POST", { name: "Builders", memberFamiliarIds: ["nova"], projectGrants: [{ projectId: "home", access: "read" }, { projectId: "app", access: "write" }] })), "create with Read");
  const id = created.group.id;
  await refused(group.PATCH(request("PATCH", { projectGrants: [{ projectId: "home", access: "write" }, { projectId: "app", access: "write" }] }), params(id)), "raise to Write");
  await ok(group.PATCH(request("PATCH", { name: "Makers", memberFamiliarIds: ["nova", "kitty"] }), params(id)), "rename and add a member");

  // A member gaining Write through a grant saved before the rule.
  const file = JSON.parse(await readFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, "utf8"));
  file.accessGroups[0].projectGrants[0].access = "write";
  await writeFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, JSON.stringify(file));
  const memberRefusal = await refused(group.PATCH(request("PATCH", { memberFamiliarIds: ["nova", "kitty", "echo"] }), params(id)), "a new member");
  assert.match(memberRefusal.error, /^Adding echo to Makers would give it Write access to Coven home/);
  await ok(group.PATCH(request("PATCH", { projectGrants: [{ projectId: "home", access: "read" }, { projectId: "app", access: "write" }] }), params(id)), "narrowing to Read");

  // Supreme's proposals: a Write draft and an old Write acceptance are refused.
  await refused(proposals.POST(request("POST", { proposedBy: "supreme", targetFamiliarId: "nova", projectId: "home" })), "a Write proposal");
  const stored = JSON.parse(await readFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, "utf8"));
  stored.grantProposals.push({ id: "old", proposedBy: "supreme", targetFamiliarId: "nova", projectId: "home", access: "write", status: "pending", createdAt: "now" });
  await writeFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, JSON.stringify(stored));
  await refused(proposal.PATCH(request("PATCH", { decision: "accepted" }), params("old")), "accepting an old Write proposal");
  await ok(proposal.PATCH(request("PATCH", { decision: "rejected" }), params("old")), "rejecting it");
  await ok(proposals.POST(request("POST", { proposedBy: "supreme", targetFamiliarId: "nova", projectId: "app" })), "a Write proposal elsewhere");

  // The direct-grant route maps the same refusal: its target lookup needs the
  // daemon's roster, so its mapping is pinned here and its rule by the store test.
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /await grantProjectToFamiliar\([\s\S]*?\} catch \(error\) \{\s*if \(error instanceof CavePrivateStateGrantError\) \{\s*return NextResponse\.json\(\s*\{ ok: false, code: error\.code, error: error\.message, projectId: error\.project\.id \},\s*\{ status: error\.status \},/,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
