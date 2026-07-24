// @ts-nocheck
// ProjectSetupModal — the in-place "register this ad-hoc folder" flow (spec
// 2026-07-24). It must explain what registering entails, default the chat's
// familiar to write (the chat needs to keep running here) and groups to no
// access, honor Supreme's all-access status, and sequence create → familiar
// grant → group patches with a single registry emit — retrying after a
// partial failure without duplicating the project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./project-setup-modal.tsx", import.meta.url), "utf8");

// ── Explains what registering entails ──────────────────────────────────────
assert.match(src, /Registering makes this folder a project across the Cave/, "explainer copy present");
assert.match(src, /Familiars can only work in a project after you grant access/, "grant model explained");
assert.match(src, /changed later in Projects and Permissions/, "reversibility called out");

// ── Preference defaults ─────────────────────────────────────────────────────
assert.match(src, /useState<AccessChoice>\("write"\)/, "familiar access defaults to write");
assert.match(src, /groupLevels\[group\.id\] \?\? "none"/, "groups default to no access");
assert.match(src, /familiar\.id === supremeFamiliarId/, "Supreme is detected and grant-skipped");
assert.match(src, /has access to every project/, "Supreme renders as all-access, not a select");

// ── Submit sequence ─────────────────────────────────────────────────────────
assert.match(src, /emitMutation: false/, "creation suppresses its own emit (single fan-out)");
assert.match(src, /"\/api\/project-grants"/, "familiar grant goes to the grants route");
assert.match(src, /targetFamiliarId: familiar\.id/, "grant sends targetFamiliarId (never familiarId)");
assert.match(src, /`\/api\/access-groups\/\$\{group\.id\}`/, "group grants PATCH each group");
assert.match(
  src,
  /\.filter\(\(grant\) => grant\.projectId !== project\.id\)/,
  "group patch replaces any same-project grant instead of duplicating",
);
assert.match(src, /emitProjectRegistryMutation\(\)/, "registry listeners get refreshed");
assert.match(src, /setCreatedProject\(project\)/, "retry after partial failure skips re-creation");

// ── Prefill + validation ────────────────────────────────────────────────────
assert.match(src, /&remote=1/, "GitHub prefill probes the changes remote endpoint");
assert.match(src, /normalizeGitHubRepoUrl/, "repo input validates through the shared normalizer");
assert.match(src, /current\.trim\(\) \? current : /, "prefill never clobbers what the user typed");

// ── Primitives + a11y ───────────────────────────────────────────────────────
assert.match(src, /<Modal\b/, "built on the shared Modal (focus trap + return)");
assert.match(src, /useAnnouncer\(\)/, "completion is announced");
assert.match(src, /StandardSelect/, "access levels use the shared select primitive");
assert.match(src, /aria-pressed=/, "color swatches expose pressed state");
assert.match(src, /PROJECT_SETUP_COLOR_CHOICES/, "swatch palette comes from the lib, not render literals");

assert.match(
  src,
  /createProject: \(\s*name: string,\s*root: string,\s*options\?: CreateProjectOptions,\s*\) => Promise<CaveProject>;/,
  "the modal requires the throwing create variant so failures carry the server message",
);
assert.match(
  src,
  /error instanceof Error && error\.message\s*\?\s*error\.message/,
  "create failures surface the server's error body, not a generic guess",
);

console.log("project-setup-modal.test.ts OK");
