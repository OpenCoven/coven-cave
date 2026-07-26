import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

const boardTypes = await source("lib/cave-board-types.ts");
const boardStore = await source("lib/cave-board.ts");
const boardCreateApi = await source("app/api/board/route.ts");
const boardPatchApi = await source("app/api/board/[id]/route.ts");
const boardInspector = await source("components/board-inspector.tsx");
const asanaTasks = await source("lib/asana-tasks.ts");
const taskAsana = await source("lib/task-asana.ts");
const beadsApi = await source("app/api/beads/route.ts");
const asanaAssigned = await source("app/api/asana/assigned/route.ts");
const asanaPat = await source("app/api/asana/pat/route.ts");
const queueStrip = await source("components/asana-queue-strip.tsx");

// ── Card model + persistence ─────────────────────────────────────────────────
assert.match(boardTypes, /export type CardAsanaLink = \{/, "Task cards expose a structured Asana connection type");
assert.match(boardTypes, /asana: CardAsanaLink\[\]/, "Task cards persist structured Asana connections");
assert.match(boardStore, /normalizeAsanaLinks/, "Board persistence normalizes Asana connections");
assert.match(boardStore, /asanaLinksFromLinks/, "Board backfill derives Asana connections from bare links");
assert.match(
  boardStore,
  /const asana = mergeAsanaLinks\(normalizeAsanaLinks\(c\.asana\), \.\.\.asanaLinksFromLinks\(c\.links\)\)/,
  "Board backfill preserves explicit Asana connections and derives them from link URLs",
);

// ── API surface ──────────────────────────────────────────────────────────────
assert.match(boardCreateApi, /asana\?: CardAsanaLink\[\]/, "Create task API accepts structured Asana connections");
assert.match(boardPatchApi, /asana: CardAsanaLink\[\]/, "Patch task API accepts structured Asana connections");

// ── Inspector attach ─────────────────────────────────────────────────────────
assert.match(boardInspector, /function AsanaAttachSection\(/, "Inspector renders an Asana attach section");
assert.match(
  boardInspector,
  /const asana = mergeTaskAsanaLinks\(card\.asana[\s\S]*?taskAsanaLinkFromAsanaItem\(item\)/,
  "Inspector Asana attach merges structured connections onto the card",
);

// ── Create-card / bead-from-Asana helpers ────────────────────────────────────
assert.match(
  asanaTasks,
  /asana: \[taskAsanaLinkFromAsanaItem\(item\)\]/,
  "createBoardCardFromAsanaItem seeds the card's asana field",
);
assert.match(asanaTasks, /action: "create"/, "fileAsanaItemAsBead routes through the beads create action");
assert.match(asanaTasks, /externalRef: item\.url/, "fileAsanaItemAsBead links the Asana permalink as external-ref");

// task-asana helpers must stay isomorphic (importable from client + server), so
// they can't pull in server-only modules.
assert.doesNotMatch(taskAsana, /next\/server|node:fs|node:child_process/, "task-asana helpers stay isomorphic");

// ── Beads bridge ─────────────────────────────────────────────────────────────
assert.match(beadsApi, /parsed\.body\.action === "create"/, "Beads API handles a create action");
assert.match(beadsApi, /"--external-ref"/, "Beads create passes --external-ref for the source ticket");

// ── Live data routes gate on the connected PAT ───────────────────────────────
assert.match(asanaAssigned, /configured: false/, "Assigned route reports unconfigured when no PAT is stored");
assert.match(asanaAssigned, /completed_since=now/, "Assigned route requests only incomplete tasks");
assert.match(asanaPat, /ASANA_PAT/, "PAT route stores the Asana token under ASANA_PAT");

// ── Queue strip degrades silently ────────────────────────────────────────────
assert.match(
  queueStrip,
  /if \(!configured \|\| items\.length === 0\) return null/,
  "Queue Asana strip renders nothing when Asana is unconnected or empty",
);
// Distinct class from the warning-toned attention strip — never collides with
// the .fwq-attention count assertions in familiar-work-queue.spec.ts.
assert.doesNotMatch(queueStrip, /className="fwq-attention/, "Queue Asana strip uses its own fwq-asana classes");
assert.match(queueStrip, /className="fwq-asana"/, "Queue Asana strip uses the fwq-asana container class");
// Freshness: refreshes on the Queue's poll cadence (cave-m4h9) with an equality
// guard so identical polls don't churn re-renders.
assert.match(queueStrip, /usePausablePoll\(\(\) => void load\(\), 30_000/, "Queue Asana strip refreshes on the 30s poll");
assert.match(queueStrip, /function sameItems\(/, "Queue Asana strip guards identical polls against re-render churn");

// ── Per-agent assignment (cave-vn19): connect once, assign per familiar ──────
{
  const caveConfig = await source("lib/cave-config.ts");
  const familiarsRoute = await source("app/api/familiars/route.ts");
  const familiarType = await source("lib/types.ts");
  const brainTab = await source("components/familiar-studio-brain-tab.tsx");
  const asanaSection = await source("components/familiar-asana-section.tsx");
  const workspacesRoute = await source("app/api/asana/workspaces/route.ts");
  const workQueueView = await source("components/familiar-work-queue-view.tsx");

  // Data model: per-agent enablement + workspace scope ride FamiliarBinding.
  assert.match(caveConfig, /asanaEnabled\?: boolean/, "FamiliarBinding carries per-agent Asana enablement");
  assert.match(caveConfig, /asanaWorkspaceGid\?: string/, "FamiliarBinding carries a per-agent Asana workspace scope");
  assert.match(caveConfig, /asanaEnabled: f\.asanaEnabled/, "bindingFor surfaces asanaEnabled");
  assert.match(familiarType, /asanaEnabled\?: boolean/, "the Familiar type exposes asanaEnabled to the UI");
  assert.match(familiarsRoute, /asanaEnabled: configEntry\.asanaEnabled/, "the familiars route maps asanaEnabled through");

  // Assigned route honors the familiar's assignment: opt-out + workspace scope.
  assert.match(asanaAssigned, /searchParams\.get\("familiarId"\)/, "assigned route accepts a familiarId scope");
  assert.match(asanaAssigned, /bindingFor\(await loadConfig\(\)/, "assigned route reads the familiar's binding");
  assert.match(asanaAssigned, /binding\.asanaEnabled === false[\s\S]{0,160}assigned: false/, "an opted-out agent gets assigned:false and no tasks");
  assert.match(asanaAssigned, /binding\.asanaWorkspaceGid/, "a scoped agent's fan-out filters to its workspace");

  // Workspaces route backs the scope picker.
  assert.match(workspacesRoute, /export async function GET/, "the workspaces route exists for the scope picker");
  assert.match(workspacesRoute, /workspaces\.name/, "the workspaces route lists the user's Asana workspaces");

  // Brain tab hosts connect + assignment in one per-agent place.
  assert.match(brainTab, /<FamiliarAsanaSection familiar=\{familiar\}/, "the Brain tab renders the per-agent Asana section");
  assert.match(asanaSection, /\/api\/asana\/pat/, "the section connects the app-wide PAT inline (seamless)");
  assert.match(asanaSection, /asanaEnabled: next \? null : false/, "the toggle opts the agent in (null=on) or out (false)");
  assert.match(asanaSection, /asanaWorkspaceGid: gid \|\| null/, "the scope select persists the workspace gid");

  // Board + Queue scope to the agent.
  assert.match(boardInspector, /assigned\?familiarId=\$\{encodeURIComponent\(card\.familiarId\)\}/, "the inspector picker scopes to the card's familiar");
  assert.match(queueStrip, /familiarId\?: string \| null/, "the Queue strip accepts a familiar scope");
  assert.match(queueStrip, /data\.assigned !== false/, "the Queue strip hides for an opted-out agent");
  assert.match(workQueueView, /familiarId=\{activeFamiliarId\}/, "the Queue view scopes the strip to the active familiar");
}

console.log("asana task field guard passed");
