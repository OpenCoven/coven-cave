// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarsView/, "FamiliarsView must be exported");

assert.match(
  source,
  /useResolvedFamiliars\(familiars, \{ includeArchived: true \}\)/,
  "FamiliarsView should resolve local avatar images before rendering roster/detail surfaces",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{familiar\} size="sm" \/>/,
  "FamiliarsView detail header/card should render FamiliarAvatar instead of raw daemon icons",
);

assert.match(
  source,
  /<FamiliarAvatar familiar=\{f\} size="sm" \/>/,
  "FamiliarsView rail should render uploaded avatar images via FamiliarAvatar",
);

assert.match(
  source,
  /const LAST_SELECTED_KEY = "cave:agents\.lastSelected"/,
  "Selection persistence uses cave:agents.lastSelected localStorage key",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\)/,
  "Initial selectedFamiliarId reads from localStorage",
);

assert.match(
  source,
  /window\.localStorage\.getItem\(LAST_SELECTED_KEY\) \? "detail" : "roster"/,
  "Initial viewMode boots into detail when a selection is persisted, else roster",
);

assert.match(
  source,
  /fetch\("\/api\/coven-memory"[\s\S]*fetch\("\/api\/memory"/,
  "Memory data is fetched from /api/coven-memory and /api/memory",
);

assert.match(
  source,
  /setInterval\(loadMemory, 30_000\)/,
  "Memory data refreshes on 30s interval",
);

assert.match(
  source,
  /buildFamiliarCardStats\(\{[\s\S]*familiars,[\s\S]*sessions,[\s\S]*covenEntries[\s\S]*\}\)/,
  "Per-card stats are derived from buildFamiliarCardStats",
);

assert.match(
  source,
  /viewMode === "detail" && selectedFamiliar/,
  "Detail layout renders when viewMode is detail and a familiar is selected",
);

assert.match(
  source,
  /<FamiliarDetailRail[\s\S]*<FamiliarDetailPanel/,
  "Detail layout mounts the rail + panel",
);

assert.match(
  source,
  /const memoryFamiliar = selectedFamiliar \?\? resolvedActiveFamiliar \?\? null/,
  "Familiar memory scope falls back to the resolved workspace-selected familiar",
);

assert.match(
  source,
  /<FamiliarMemoryOverlay[\s\S]*familiar=\{memoryFamiliar\}/,
  "Familiar memory overlay is scoped to the selected familiar",
);

assert.match(
  source,
  /const \[previewFamiliar, setPreviewFamiliar\] = useState<ResolvedFamiliar \| null>\(null\)/,
  "FamiliarsView tracks the familiar selected for avatar preview",
);

assert.match(
  source,
  /onPreview=\{setPreviewFamiliar\}/,
  "Detail rail can open the enlarged avatar preview",
);

assert.match(
  source,
  /onClick=\{\(\) => \{\s*onSelect\(f\.id\);\s*onPreview\(f\);/,
  "Selecting a rail avatar opens the preview for that familiar",
);

assert.match(
  source,
  /aria-label=\{`Preview \$\{f\.display_name\}'s avatar`\}/,
  "Rail avatar buttons expose preview intent to assistive tech",
);

assert.match(
  source,
  /aria-label=\{`Enlarge \$\{familiar\.display_name\}'s avatar`\}/,
  "Detail header avatar exposes an enlarge action",
);

assert.match(
  source,
  /<FamiliarAvatarPreviewOverlay[\s\S]*familiar=\{previewFamiliar\}/,
  "Avatar preview overlay renders for the selected preview familiar",
);

assert.match(
  source,
  /<Modal[\s\S]*ariaLabel=\{`\$\{familiar\.display_name\} avatar preview`\}/,
  "Avatar preview uses the shared modal with an accessible label",
);

assert.match(
  source,
  /familiar\.avatarImage \?[\s\S]*className="h-full w-full object-cover"/,
  "Avatar preview enlarges uploaded avatar images",
);

assert.match(
  source,
  /setViewMode\("agent-memory"\)/,
  "Header button switches to agent-memory mode",
);

assert.doesNotMatch(
  source,
  /Memory across all agents/,
  "Familiars view should not expose global all-agents memory copy",
);

assert.match(
  source,
  /<h1[^>]*>Familiars<\/h1>/,
  "Page heading uses Familiars instead of Agents",
);

assert.match(
  source,
  /Familiar memory/,
  "Memory action uses singular Familiar copy",
);

assert.match(
  source,
  /activeFamiliar=\{familiar\}[\s\S]*lockToFamiliar/,
  "Familiar memory overlay passes the selected familiar and locks the memory filter",
);

assert.match(
  source,
  /onClose=\{\(\) => setViewMode\(selectedFamiliarId \? "detail" : "roster"\)\}/,
  "Closing the overlay restores the previous viewMode based on selection",
);

assert.match(
  source,
  /FamiliarsEmptyState[\s\S]*onOpenOnboarding/,
  "Empty state CTA wires to onOpenOnboarding",
);

assert.match(
  source,
  /lockToFamiliar/,
  "Memory tab inside detail passes lockToFamiliar to FamiliarsMemoryView",
);

assert.match(
  source,
  /const familiarFileEntries = useMemo\([\s\S]*entry\.familiarId === familiar\.id[\s\S]*\[fileEntries, familiar\.id\]/,
  "Files tab filters memory files to the selected familiar",
);

assert.match(
  source,
  /entries=\{familiarFileEntries\}/,
  "Files tab passes only the selected familiar's files to MemoryFilesList",
);

assert.match(
  source,
  /listClassName="h-full min-h-0 divide-y divide-\[var\(--border-hairline\)\] overflow-y-auto"/,
  "Files tab gives MemoryFilesList a panel-height scroll container",
);

assert.doesNotMatch(
  source,
  /list is the same for every familiar/,
  "Files tab should not describe the per-familiar list as global",
);

assert.match(
  source,
  /role="dialog"[\s\S]*aria-modal="true"/,
  "Overlay exposes modal dialog semantics",
);

assert.match(
  source,
  /\{ id: "daily-notes", label: "Daily Notes" \}/,
  "Detail panel exposes a Daily Notes tab",
);

assert.match(
  source,
  /tab === "daily-notes" \? \(\s*<FamiliarDailyNotes familiar=\{familiar\} \/>/,
  "Daily Notes tab renders FamiliarDailyNotes scoped to the selected familiar",
);

// Detail tabs use the shared accessible <Tabs> (role=tab/aria-selected/roving),
// not a hand-rolled button strip with aria-current="page".
assert.match(source, /import \{ Tabs \} from "@\/components\/ui\/tabs"/, "imports shared Tabs");
assert.match(source, /<Tabs[\s\S]{0,200}?idPrefix="familiar-detail"/, "detail panel uses shared Tabs with idPrefix");
assert.match(source, /role="tabpanel"[\s\S]{0,120}?aria-labelledby=\{`familiar-detail-tab-/, "content area is a labelled tabpanel");
assert.doesNotMatch(source, /aria-current=\{tab === id \? "page"/, "old aria-current=page tab pattern is gone");

console.log("familiars-view: all assertions passed");
