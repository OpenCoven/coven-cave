// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source contracts for the Chat → Projects "Project access" page: one
// familiar's access map over every registered project, cycled per row against
// /api/project-grants. Pure derivations (sections, cycle, counts, filter,
// bulk ops) are behaviorally tested in src/lib/projects/access-page.test.ts;
// these pins guard the React wiring and the page's cave-styled shell.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const view = read("./projects-view.tsx");
const css = read("../styles/projects.css");
const chatSurface = read("./chat-surface.tsx");

test("the surface keeps its mount contract with ChatSurface", () => {
  // Direct CSS import: the surface is reachable straight from the Chat →
  // Projects tab, before any other surface has ever mounted.
  assert.match(view, /import "@\/styles\/projects\.css"/, "styles are imported by the component itself");
  assert.match(view, /export function ProjectsView\(/, "keeps the ProjectsView export ChatSurface lazy-loads");
  // Props stay the full historical contract so ChatSurface compiles untouched.
  assert.match(view, /sessions\?: SessionRow\[\]/);
  assert.match(view, /familiars\?: Familiar\[\]/);
  assert.match(view, /onSessionsDeleted: \(sessionIds: readonly string\[\]\) => void/);
  assert.match(view, /activeFamiliarId\?: string \| null/);
  assert.match(chatSurface, /scope === "projects" \? \(/, "ChatSurface still branches to the Projects surface");
});

test("the header is the cave-typography access hero", () => {
  assert.match(view, /className="projects-access-eyebrow">Familiars</, "eyebrow reads Familiars");
  assert.match(view, /className="projects-access-title">Project access</, "serif display title");
  assert.match(view, /Choose what each familiar can see and touch\./, "subtitle explains the page");
  assert.match(css, /\.projects-access-title \{[^}]*font-family: var\(--font-serif, ui-serif, serif\)/, "title uses the cave serif");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*font-family: var\(--font-mono, ui-monospace, monospace\)/, "eyebrow is mono");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*text-transform: uppercase/, "eyebrow is uppercase");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*color: var\(--accent-presence\)/, "eyebrow carries the accent");
});

test("the toolbar carries picker, search, tally, and reset", () => {
  assert.match(view, /<StandardSelect[\s\S]{0,200}label="Familiar"/, "familiar picker is the shared select");
  assert.match(view, /onChange=\{\(id\) => setPickedFamiliarId\(id\)\}/, "picking a familiar switches the matrix");
  assert.match(view, /if \(activeFamiliarId\) setPickedFamiliarId\(activeFamiliarId\)/, "follows the chat's active familiar");
  assert.match(view, /placeholder="Find a project…"/, "search placeholder matches the design");
  assert.match(view, /e\.key !== "\/"/, "the / shortcut jumps to search");
  assert.match(view, /accessCounts\(/, "tally uses the pure counts helper");
  assert.match(view, /counts\.none[\s\S]*counts\.read[\s\S]*counts\.write/, "renders all three tallies");
  assert.match(view, />\s*Reset all\s*</, "offers Reset all");
  assert.match(view, /await confirm\(\{[\s\S]{0,200}title: `Reset \$\{familiarLabel\(familiar\)\}’s access\?`/, "reset is confirm-gated");
});

test("rows cycle a direct grant against /api/project-grants", () => {
  assert.match(view, /const \{ projects, loading: projectsLoading, error: projectsError, reload, createProject, updateRepoUrl, renameProject, deleteProject \} = useProjects\(\)/, "projects load unscoped — access is managed over every project");
  assert.match(view, /fetch\("\/api\/project-grants", \{ cache: "no-store" \}\)/, "grants snapshot comes from the console API");
  assert.match(view, /method: op\.op === "grant" \? "POST" : "DELETE"/, "grant/revoke map to POST/DELETE");
  assert.match(view, /targetFamiliarId: familiarId/, "mutations target the picked familiar");
  assert.match(view, /nextAccessState\(row\.state\)/, "click advances the none → read → full cycle");
  assert.match(view, /resolveEffectiveAccess\(\{/, "pills show the effective level (direct ∪ groups)");
  assert.match(view, /setOptimistic\(/, "mutations render optimistically");
  assert.match(view, /await loadGrants\(\)/, "server snapshot is re-fetched after a mutation");
  assert.match(view, /splitProjectsBySection\(filtered\)/, "sections derive from the pure splitter");
  assert.match(view, /setAllOps\(/, "bulk actions compute the minimal op set");
  assert.match(view, /keeps \$\{accessStateMeta\(row\.state\)\.label\} via/, "group-held access explains itself instead of firing a no-op revoke");
});

test("the supreme familiar renders locked at Full", () => {
  assert.match(view, /isSupreme\(familiar\.id, grantsData\?\.supremeFamiliarId \?\? null\)/, "supreme comes from the console API");
  assert.match(view, /state: "write", direct: "write", groupNames: \[\] \}/, "supreme rows pin to Full");
  assert.match(view, /supreme familiar — full access to everything, always\./, "explains the lock");
  assert.match(view, /disabled=\{pending \|\| supreme\}/, "supreme rows don't cycle");
});

test("command-palette focus scrolls and flashes the row", () => {
  assert.match(view, /CHAT_FOCUS_PROJECT_EVENT/, "keeps the palette Open-project listener");
  assert.match(view, /setFlashId\(match\.id\)/, "flashes the focused row");
  assert.match(view, /scrollIntoView\(\{ block: "center", behavior: smoothScrollBehavior\(\) \}\)/, "respects reduced motion");
});

test("pills and states are token-driven for both themes", () => {
  assert.match(css, /\.projects-access-pill\.is-write \{[^}]*background: var\(--accent-presence\)/, "Full pill fills with the accent");
  assert.match(css, /\.projects-access-pill\.is-write \{[^}]*color: var\(--accent-presence-foreground\)/, "Full pill text uses the paired foreground token");
  assert.match(css, /\.projects-access-pill\.is-read \{[^}]*color-mix\(in oklch, var\(--accent-presence\) 12%, transparent\)/, "Read pill is an accent tint");
  assert.match(css, /\.projects-access-pill\.is-none \{[^}]*color: var\(--text-muted\)/, "No-access pill stays muted");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hard-coded hex colors — theme tokens only");
  assert.match(css, /\.projects-access-row\.is-flash/, "flash state is styled");
  assert.match(css, /\.projects-access-rule \{[^}]*background: var\(--border-hairline\)/, "section rules are hairlines");
});

test("empty projects offer New project and Ask Salem", () => {
  assert.match(view, /Create one here, or register a folder from the chat composer\./, "empty state points at both creation paths");
  assert.match(view, /Ask Salem/, "projects empty state offers Ask Salem");
  assert.match(view, /cave:salem-open/, "Ask Salem opens the Salem rail");
});

test("the toolbar creates projects through the one shared add flow", () => {
  assert.match(view, /import \{ useAddProjectFlow \} from "@\/components\/project-picker"/, "creation reuses the shared add-project flow (native dialog + web fallback + grant)");
  assert.match(view, /const addFlow = useAddProjectFlow\(\{[\s\S]{0,200}familiarId: familiar\?\.id \?\? null/, "the new project is granted to the picked familiar");
  assert.match(view, /createProject, updateRepoUrl, renameProject, deleteProject \} = useProjects\(\)/, "creation + repo-link + rename/remove mutations come from useProjects");
  assert.match(view, /onAdded: \(\) => \{[\s\S]{0,120}reload\(\);[\s\S]{0,120}void loadGrants\(\);/, "a successful add refreshes both the registry and the grants snapshot");
  assert.match(view, /className="projects-access-new"[\s\S]{0,220}onClick=\{addFlow\.beginAddProject\}/, "the toolbar exposes the New project button");
  assert.match(view, />\s*\{addFlow\.adding \? "Adding…" : "New project"\}\s*</, "the button reflects the in-flight add");
  assert.match(view, /\{addFlow\.addError \? \([\s\S]{0,120}projects-access-error/, "add failures surface on the page");
  assert.match(view, /\{addFlow\.addProjectModal\}/, "the web-fallback directory browser is mounted");
});

test("each row opens per-project settings with the GitHub repo link", () => {
  assert.match(view, /import \{ ProjectSettingsModal \} from "@\/components\/project-settings-modal"/, "settings live in the shared modal component");
  assert.match(view, /className="projects-access-rowwrap"/, "rows wrap the access button and the settings trigger");
  assert.match(view, /className="projects-access-row-settings focus-ring"[\s\S]{0,120}onClick=\{\(\) => setSettingsProjectId\(project\.id\)\}/, "the gear opens that project's settings");
  assert.match(view, /aria-label=\{`Project settings — \$\{project\.name\}`\}/, "the settings trigger is named per project");
  assert.match(view, /\{project\.repoUrl \? \([\s\S]{0,160}ph:github-logo/, "repo-linked rows carry the GitHub indicator");
  assert.match(view, /<ProjectSettingsModal[\s\S]{0,160}project=\{settingsProject\}[\s\S]{0,160}onSaveRepoUrl=\{saveRepoUrl\}/, "the modal is wired to the derived project + save handler");
  assert.match(view, /const ok = await updateRepoUrl\(id, repoUrl\);/, "saves go through useProjects().updateRepoUrl");
  assert.match(css, /\.projects-access-rowwrap \{/, "rowwrap layout is styled");
  assert.match(css, /\.projects-access-row-settings \{/, "settings trigger is styled");
  assert.match(css, /\.projects-access-row-repo \{/, "GitHub indicator is styled");
});

test("the settings modal also renames and removes from the registry (issue #3710)", () => {
  assert.match(view, /<ProjectSettingsModal[\s\S]{0,260}onRename=\{renameProjectAndAnnounce\}[\s\S]{0,60}onDelete=\{removeProject\}/, "the modal carries rename + remove handlers");
  assert.match(view, /const ok = await renameProject\(id, name\);/, "rename goes through useProjects().renameProject");
  assert.match(view, /const ok = await deleteProject\(id\);/, "remove goes through useProjects().deleteProject");
  // Removing a project must refresh the grant matrix — the DELETE cascade
  // revoked its grants server-side, so the stale rows have to drop out.
  assert.match(view, /await deleteProject\(id\);[\s\S]{0,160}void loadGrants\(\);/, "a removal reloads the grants snapshot");
});
