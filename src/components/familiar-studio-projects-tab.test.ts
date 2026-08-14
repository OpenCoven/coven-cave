// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tab = readFileSync(new URL("./familiar-studio-projects-tab.tsx", import.meta.url), "utf8");
const inline = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./familiar-tab-settings.tsx", import.meta.url), "utf8");
const projectsView = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("../lib/familiar-studio-context.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/project-grants/route.ts", import.meta.url), "utf8");

// ── Project access lives on ONE surface: Chat → Projects (cave-2tmly) ────────
// Two live copies of the same grant matrix — here and in the familiar's
// settings — were editing the same /api/project-grants. The settings copy is
// gone; this component survives as the Activity pane of Chat → Projects.
assert.match(tab, /export function FamiliarStudioProjectsTab/, "exports the per-familiar Projects tab");
assert.match(context, /"projects"/, "studio tab union still carries projects for the redirect handoff");
assert.doesNotMatch(inline, /id: "projects", label: "Projects"/, "inline studio no longer exposes a Projects tab");
assert.doesNotMatch(inline, /activeTab === "projects" \? \(/, "inline studio no longer renders a Projects body");
assert.doesNotMatch(inline, /AccessGroupsSection/, "access groups no longer hide inside the inline studio");
assert.doesNotMatch(settings, /id: "projects", label: "Projects"/, "familiar settings no longer lists a Projects tab");
assert.doesNotMatch(settings, /AccessGroupsSection/, "access groups no longer hide inside familiar settings");
// A stored/deep-linked `projects` target must go somewhere real, not silently
// land on Identity.
assert.match(
  settings,
  /initialTab === "projects"[\s\S]{0,200}CHAT_OPEN_PROJECTS_EVENT/,
  "a projects target redirects to Chat → Projects",
);
assert.match(
  inline,
  /activeTab === "contract" \|\| activeTab === "projects" \? "identity"/,
  "a stored projects tab resolves to a tab that still exists",
);

// ── Chat → Projects mounts distinct directory and host-authority panes ───────
assert.match(projectsView, /type ProjectsPane = "access" \| "host" \| "groups" \| "activity"/, "the surface names four panes");
assert.match(projectsView, /<HostAccessSection familiarId=\{familiar\?\.id\} \/>/, "host authority is distinct from project access");
assert.match(
  projectsView,
  /<AccessGroupsSection familiars=\{resolvedFamiliars\} \/>/,
  "access groups are a peer pane, not a buried section",
);
assert.match(
  projectsView,
  /<FamiliarStudioProjectsTab[\s\S]{0,160}variant="activity"/,
  "the governance panels mount in activity mode, without a second grant matrix",
);
assert.match(projectsView, /count: groupCount/, "the Groups tab carries a count so the primitive is visible at a glance");

// ── The activity variant suppresses the duplicated matrix ────────────────────
assert.match(tab, /variant\?: FamiliarProjectsVariant/, "the component takes a variant");
assert.match(tab, /const showMatrix = variant === "full"/, "full mode is the only one that renders the matrix");
assert.match(tab, /\{!showMatrix \? null : supreme \? \(/, "activity mode drops the grant matrix entirely");

// ── The standalone Settings → Permissions section is gone ────────────────────
assert.doesNotMatch(shell, /PermissionsSection/, "shell no longer mounts a standalone Permissions section");
assert.doesNotMatch(shell, /id: "permissions"/, "settings nav no longer lists a Permissions section");
assert.doesNotMatch(shell, /section === "permissions"/, "shell no longer routes a permissions section");

// ── Projects tab speaks the project-permissions protocol, scoped to one familiar ─
assert.match(tab, /fetch\("\/api\/projects"/, "loads projects");
assert.match(tab, /fetch\("\/api\/project-grants"/, "loads grants + supreme familiar + audit");
assert.match(tab, /fetch\("\/api\/grant-proposals"/, "loads the grant-proposal inbox");
// Toggling a project grants (POST) or revokes (DELETE) — sending ONLY this
// familiar + the project (+ the access level on grant; the grant route rejects
// relayed approvals).
assert.match(tab, /method: next \? "POST" : "DELETE"/, "toggling on grants, off revokes");
assert.match(
  tab,
  /\{ targetFamiliarId: familiar\.id, projectId, access \}/,
  "granting sends only the selected familiar + project + level (human-confirmed)",
);
assert.match(
  tab,
  /\{ targetFamiliarId: familiar\.id, projectId \}/,
  "revoking sends only the selected familiar + project (human-confirmed)",
);
assert.match(tab, /role="switch"/, "each project row is a switch");
// Read/write levels + access groups render on every project row.
assert.match(tab, /<Segmented\b/, "granted rows expose a read/write level control via the shared Segmented primitive");
assert.match(
  tab,
  /setAccess\(project\.id, candidate\)/,
  "picking a level re-grants the project at that level",
);
assert.match(tab, /effectiveAccessRows\(\{/, "effective access resolves direct + group grants with the shared union-max helper");
assert.match(tab, /groupsForFamiliar\(accessGroups, familiar\.id\)/, "lists the access groups this familiar belongs to");
assert.match(tab, /accessLevelMeta\(/, "levels render through the shared read/write meta");
assert.match(tab, /access group/i, "explains group-derived access");
// Proposals are resolved by id (PATCH), sending only the decision.
assert.match(tab, /\/api\/grant-proposals\/\$\{id\}/, "resolves a proposal by id");
assert.match(tab, /method: "PATCH"/, "proposal decisions are a PATCH");
assert.match(tab, /JSON\.stringify\(\{ decision \}\)/, "sends only the accept/reject decision");
// The supreme (all-access) familiar is surfaced, not toggle-able.
assert.match(tab, /isSupreme\(familiar\.id, supremeFamiliarId\)/, "marks the supreme (all-access) familiar");
assert.match(tab, /has access to every project/i, "explains the all-access familiar");
// Everything is filtered to THIS familiar.
assert.match(tab, /p\.targetFamiliarId === familiar\.id/, "requests are scoped to this familiar");
assert.match(tab, /e\.familiarId === familiar\.id/, "audit is scoped to this familiar");
assert.match(tab, /useUserProfile\(\)/, "grant source labels subscribe to profile hydration and renames");
assert.match(
  tab,
  /grantSourceMeta\(meta\.source, userDisplayName\(profileSnapshot\?\.profile\)\)/,
  "human grant source labels use the current operator profile display name",
);

// ── API still exposes the supreme familiar + a bounded recent audit window ───
assert.match(route, /supremeFamiliarId: config\.supremeFamiliarId/, "the grants GET returns the supreme familiar id");
assert.match(route, /listRecentPermissionAudit/, "the grants GET returns a recent audit window");
assert.match(route, /listAccessGroups/, "the grants GET rides access groups along for effective access");

// ── Registry CRUD from the access surface (issue #3710) ──────────────────────
assert.match(tab, /import \{ useProjects \} from "@\/lib\/use-projects"/, "pulls the registry hook for CRUD");
assert.match(tab, /import \{ useAddProjectFlow \} from "@\/components\/project-picker"/, "reuses the shared add-project flow");
assert.match(tab, /import \{ ProjectSettingsModal \} from "@\/components\/project-settings-modal"/, "opens the shared project settings modal");
assert.match(
  tab,
  /createProject,\s*createProjectOrThrow,\s*renameProject,\s*deleteProject,\s*updateRepoUrl,\s*\} = useProjects\(\{ familiarId: familiar\.id \}\)/,
  "the registry mutations come from useProjects",
);
assert.match(tab, /useAddProjectFlow\(\{[\s\S]{0,220}createProjectOrThrow,/, "the shared add flow preserves local-only creation guidance");
assert.match(tab, /\{addFlow\.addError \? \(/, "familiar studio renders add-project failures");
assert.match(tab, /onClick=\{addFlow\.beginAddProject\}/, "an Add project affordance exists");
assert.match(tab, /\{addFlow\.addProjectModal\}/, "the add-project directory browser is mounted");
assert.match(tab, /icon="ph:gear-six"[\s\S]{0,220}onClick=\{\(\) => setSettingsProjectId\(project\.id\)\}/, "each row opens per-project settings");
assert.match(
  tab,
  /<ProjectSettingsModal[\s\S]{0,240}onRename=\{renameRegistryProject\}[\s\S]{0,60}onDelete=\{removeRegistryProject\}/,
  "the modal carries rename + remove handlers",
);
assert.match(tab, /const ok = await deleteProject\(id\);\s*if \(ok\) void load\(\);/, "removing a project reloads the access snapshot");

console.log("familiar-studio-projects-tab.test.ts: ok");

// ── Grant-change log surfaced in the console (cave-kbniv) ─────────────────
// grantAudit was write-only until this: #4003/#4010 recorded every change and
// nothing rendered it. These pin the read path end to end.
assert.match(
  route,
  /listRecentGrantChanges/,
  "the grants GET returns a recent grant-CHANGE window alongside the decision audit",
);
assert.match(
  route,
  /\n    grantChanges,/,
  "the change window ships in the GET payload",
);
assert.match(
  tab,
  /Array\.isArray\(grantRes\?\.grantChanges\)/,
  "the console reads the change window defensively",
);
assert.match(
  tab,
  /Recent access changes \(\$\{famChanges\.length\}\)/,
  "changes render in their own group, separate from Recent decisions",
);
assert.match(
  tab,
  /const famChanges = useMemo\(/,
  "changes are scoped to the selected familiar",
);
assert.match(
  tab,
  /\{grantLevelLabel\(e\.from\)\} → \{grantLevelLabel\(e\.to\)\}/,
  "each line shows the levels either side of the change",
);
assert.match(
  tab,
  /grantChangeOriginLabel\(e\)/,
  "each line says where the change came from",
);
