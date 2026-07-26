// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(os.tmpdir(), "cave-home-project-store-reconciliation-"));
process.env.COVEN_HOME = tmp;
delete process.env.COVEN_CAVE_HOME;
delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
delete globalThis.__caveHomeMigration;

try {
  const legacyProject = {
    id: "secret-project-id",
    name: "Secret",
    root: path.join(tmp, "secret"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await writeFile(
    path.join(tmp, "cave-projects.json"),
    JSON.stringify({ version: 1, projects: [legacyProject] }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(tmp, "cave-project-permissions.json"),
    JSON.stringify(
      {
        version: 2,
        projectGrants: [
          {
            familiarId: "supreme",
            projectId: "secret-project-id",
            access: "write",
            source: "human",
            grantedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        accessGroups: [],
        grantProposals: [],
        permissionAudit: [],
      },
      null,
      2,
    ),
    "utf8",
  );

  const { loadProjects } = await import("./cave-projects.ts");
  const { loadProjectPermissions } = await import("./project-permissions.ts");

  const projects = await loadProjects();
  assert.deepEqual(
    projects.map((project) => project.id),
    ["secret-project-id"],
    "loadProjects reconciles legacy Cave-home project state before returning authoritative grants scope",
  );
  assert.equal(
    await readFile(path.join(tmp, "cave", "projects.json"), "utf8").then((raw) => JSON.parse(raw).projects[0].id),
    "secret-project-id",
  );

  const permissions = await loadProjectPermissions();
  assert.deepEqual(
    permissions.projectGrants.map((grant) => grant.projectId),
    ["secret-project-id"],
    "loadProjectPermissions reconciles legacy grants before returning authorization data",
  );
  console.log("cave-home-project-store-reconciliation.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete globalThis.__caveHomeMigration;
  await rm(tmp, { recursive: true, force: true });
}
