/**
 * Role Surface acceptance guard: the Cave shell must never branch on a
 * specific role. All role-specific behavior lives in registered Role Surface
 * modules; the shell handles only the generic `surface:<id>` mode via the
 * registry (see src/lib/role-surfaces.ts). If this test fails, someone
 * hard-wired a role into shell code — move that logic into the surface's
 * module (or the registration manifest) instead.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Strip // and /* */ comments so prose examples don't trip the guard — the
// criterion is about CODE branching on roles, not vocabulary in docs.
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'])\/\/[^\n"]*$/gm, "$1");

// The shell: workspace orchestration, sidebar nav, shell chrome, mode source,
// and the generic host + registry machinery.
const SHELL_FILES = [
  "src/components/workspace.tsx",
  "src/components/sidebar-minimal.tsx",
  "src/components/shell.tsx",
  "src/components/role-surface-host.tsx",
  "src/lib/workspace-mode.ts",
  "src/lib/role-surfaces.ts",
  "src/lib/use-role-surfaces.ts",
];

// Any *code* reference to a specific initial role: a quoted role/surface id
// ("researcher", 'messenger-ops'…) or an imported surface identifier.
const ROLE_LITERALS = /["'`](researcher|messenger|indexer)[a-z-]*["'`]/i;
const ROLE_IDENTIFIERS =
  /\b(ResearcherSurface|MessengerSurface|IndexerSurface|RESEARCHER_SURFACE_ID|MESSENGER_SURFACE_ID|INDEXER_SURFACE_ID)\b/;

for (const rel of SHELL_FILES) {
  const code = stripComments(read(rel));
  assert.doesNotMatch(code, ROLE_LITERALS, `${rel} must not name a specific role in code`);
  assert.doesNotMatch(code, ROLE_IDENTIFIERS, `${rel} must not reference a specific surface`);
}

// The registration manifest is the ONE place the initial rooms are named…
const manifest = read("src/components/role-surfaces/register.tsx");
for (const name of ["RESEARCHER_SURFACE_ID", "MESSENGER_SURFACE_ID", "INDEXER_SURFACE_ID"]) {
  assert.match(manifest, new RegExp(`\\b${name}\\b`), `manifest registers ${name}`);
}

// …and the shell's only coupling to it is a side-effect import.
const workspace = read("src/components/workspace.tsx");
assert.match(
  workspace,
  /import "@\/components\/role-surfaces\/register"/,
  "workspace imports the manifest for its side effect only",
);

console.log("role-surface shell purity: ok");
