import assert from "node:assert/strict";

import {
  accessLevelMeta,
  accessSummary,
  auditDecisionMeta,
  auditReasonLabel,
  effectiveAccessRows,
  familiarLabel,
  filterAccess,
  filterAudit,
  grantKey,
  grantSourceMeta,
  groupsForFamiliar,
  matchesQuery,
  nameResolver,
  pendingProposalCount,
  proposalStatusMeta,
  sortFamiliars,
  splitProposals,
  surfaceLabel,
  type ConsoleAccessGroup,
  type ConsoleAuditEntry,
  type ConsoleFamiliar,
  type ConsoleProject,
  type ConsoleProposal,
} from "./permissions-console.ts";

const SUPREME = "supreme";
const familiars: ConsoleFamiliar[] = [
  { id: SUPREME, displayName: "Supreme" },
  { id: "zelda", displayName: "Zelda" },
  { id: "atlas", name: "Atlas" },
];
const projects: ConsoleProject[] = [
  { id: "p-web", name: "Web App", root: "/code/web" },
  { id: "p-api", name: "API Service", root: "/code/api" },
];

// familiarLabel + grantKey
assert.equal(familiarLabel({ id: "x", displayName: " Neo " }), "Neo");
assert.equal(familiarLabel({ id: "x", name: "Trin" }), "Trin");
assert.equal(familiarLabel({ id: "fallback-id" }), "fallback-id");
assert.equal(grantKey("a", "b"), "a::b");

// matchesQuery
assert.equal(matchesQuery("Web App", ""), true, "empty query matches all");
assert.equal(matchesQuery("Web App", "web"), true);
assert.equal(matchesQuery("Web App", "API"), false);

// sortFamiliars — supreme pinned first, rest alphabetical
assert.deepEqual(
  sortFamiliars(familiars, SUPREME).map((f) => f.id),
  [SUPREME, "atlas", "zelda"],
  "supreme first, then alpha by label",
);
assert.deepEqual(
  sortFamiliars(familiars, null).map((f) => f.id),
  ["atlas", SUPREME, "zelda"],
  "with no supreme it is pure alpha (Atlas, Supreme, Zelda)",
);

// filterAccess
const allRows = filterAccess(familiars, projects, SUPREME, "");
assert.equal(allRows.length, 3, "empty query shows every familiar");
assert.equal(allRows[0].familiar.id, SUPREME);
assert.equal(allRows[0].projects.length, 2, "empty query shows all projects per familiar");

const byProject = filterAccess(familiars, projects, SUPREME, "api service");
assert.ok(
  byProject.every((r) => r.projects.length === 1 && r.projects[0].id === "p-api"),
  "a project-name query narrows each row to the matching project",
);

const byFamiliar = filterAccess(familiars, projects, SUPREME, "zelda");
assert.equal(byFamiliar.length, 1, "a familiar-name query keeps only that familiar");
assert.equal(byFamiliar[0].familiar.id, "zelda");
assert.equal(byFamiliar[0].projects.length, 2, "matched familiar shows all its projects");

// accessSummary — grants exclude the supreme familiar
const granted = new Set([grantKey("zelda", "p-web"), grantKey("atlas", "p-api"), grantKey(SUPREME, "p-web")]);
assert.deepEqual(accessSummary(familiars, projects, granted, SUPREME), {
  familiars: 3,
  projects: 2,
  grants: 2,
});

// proposals
const proposals: ConsoleProposal[] = [
  { id: "1", proposedBy: SUPREME, targetFamiliarId: "zelda", projectId: "p-web", status: "pending", createdAt: "2026-01-02T00:00:00Z" },
  { id: "2", proposedBy: SUPREME, targetFamiliarId: "atlas", projectId: "p-api", status: "accepted", createdAt: "2026-01-01T00:00:00Z" },
  { id: "3", proposedBy: SUPREME, targetFamiliarId: "atlas", projectId: "p-web", status: "pending", createdAt: "2026-01-01T00:00:00Z" },
  { id: "4", proposedBy: SUPREME, targetFamiliarId: "zelda", projectId: "p-api", status: "accepting", createdAt: "2026-01-03T00:00:00Z", finalizesAt: "2026-01-03T00:00:30Z" },
];
const split = splitProposals(proposals);
assert.deepEqual(split.pending.map((p) => p.id), ["3", "1", "4"], "actionable inbox keeps accepting rows (undo) FIFO");
assert.deepEqual(split.resolved.map((p) => p.id), ["2"], "resolved excludes pending/accepting");
assert.equal(pendingProposalCount(proposals), 2, "accepting rows don't count as awaiting a decision");
assert.equal(proposalStatusMeta("pending").tone, "pending");
assert.equal(proposalStatusMeta("accepting").tone, "pending");
assert.equal(proposalStatusMeta("accepted").tone, "positive");
assert.equal(proposalStatusMeta("rejected").tone, "negative");

// audit
const audit: ConsoleAuditEntry[] = [
  { id: "a1", at: "2026-01-01T00:00:00Z", familiarId: "zelda", projectId: "p-web", surface: "file-read", decision: "allow", reason: "grant" },
  { id: "a2", at: "2026-01-03T00:00:00Z", familiarId: "atlas", projectId: "p-api", surface: "shell", decision: "deny", reason: "missing-grant" },
  { id: "a3", at: "2026-01-02T00:00:00Z", familiarId: SUPREME, projectId: "p-web", surface: "chat", decision: "allow", reason: "supreme" },
];
const familiarName = nameResolver(familiars, familiarLabel);
const projectName = nameResolver(projects, (p) => p.name);
const newestFirst = filterAudit(audit, { decision: "all", query: "", familiarName, projectName });
assert.deepEqual(newestFirst.map((e) => e.id), ["a2", "a3", "a1"], "audit is newest-first");
const denies = filterAudit(audit, { decision: "deny", query: "", familiarName, projectName });
assert.deepEqual(denies.map((e) => e.id), ["a2"], "decision filter narrows to denies");
const byQuery = filterAudit(audit, { decision: "all", query: "API Service", familiarName, projectName });
assert.deepEqual(byQuery.map((e) => e.id), ["a2"], "query matches the resolved project name");
const bySurface = filterAudit(audit, { decision: "all", query: "shell", familiarName, projectName });
assert.deepEqual(bySurface.map((e) => e.id), ["a2"], "query matches the surface label");

// labels / meta
assert.equal(surfaceLabel("file-write"), "File write");
assert.equal(surfaceLabel("project-api"), "Project API");
assert.equal(auditDecisionMeta("allow").tone, "positive");
assert.equal(auditDecisionMeta("deny").tone, "negative");
assert.equal(auditReasonLabel("missing-grant"), "no grant");
assert.equal(auditReasonLabel("supreme"), "all-access familiar");
assert.equal(auditReasonLabel("group"), "access group");
assert.equal(auditReasonLabel("insufficient-access"), "read-only grant");
assert.equal(grantSourceMeta("bootstrap").label, "Auto");
assert.equal(grantSourceMeta("human").label, "You");
assert.equal(nameResolver(familiars, familiarLabel)("ghost"), "ghost", "resolver falls back to the id");

// access levels + groups
assert.equal(accessLevelMeta("read").label, "Read");
assert.equal(accessLevelMeta("write").label, "Read + write");

const groups: ConsoleAccessGroup[] = [
  {
    id: "g-research",
    name: "Researchers",
    memberFamiliarIds: ["zelda"],
    projectGrants: [{ projectId: "p-api", access: "read" }],
  },
  {
    id: "g-build",
    name: "Builders",
    memberFamiliarIds: ["zelda", "atlas"],
    projectGrants: [{ projectId: "p-web", access: "write" }],
  },
];

const rows = effectiveAccessRows({
  projects,
  grants: [{ familiarId: "zelda", projectId: "p-web", access: "read" }],
  groups,
  familiarId: "zelda",
});
assert.equal(rows.length, 2, "every project gets a row, granted or not");
const webRow = rows.find((row) => row.project.id === "p-web");
assert.equal(webRow?.effective.direct, "read", "direct level is reported separately");
assert.equal(webRow?.effective.level, "write", "union-max: group write beats direct read");
assert.deepEqual(
  webRow?.effective.groups.map((g) => [g.groupId, g.access]),
  [["g-build", "write"]],
  "group sources ride along for the via-group chips",
);
const apiRow = rows.find((row) => row.project.id === "p-api");
assert.equal(apiRow?.effective.direct, null, "no direct grant on the api project");
assert.equal(apiRow?.effective.level, "read", "group-only read resolves to read");

const legacyRows = effectiveAccessRows({
  projects,
  grants: [{ familiarId: "zelda", projectId: "p-api" }],
  groups: [],
  familiarId: "zelda",
});
assert.equal(
  legacyRows.find((row) => row.project.id === "p-api")?.effective.level,
  "write",
  "legacy level-less grants mean write",
);

assert.deepEqual(
  groupsForFamiliar(groups, "zelda").map((g) => g.id),
  ["g-build", "g-research"],
  "membership summary is filtered + alpha-sorted",
);
assert.deepEqual(groupsForFamiliar(groups, "ghost"), [], "non-members get no groups");

console.log("permissions-console.test.ts: ok");
