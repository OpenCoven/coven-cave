// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./recent-activity-rollup.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

// The collapse state persists across reloads and remounts via localStorage,
// but defaults to open for SSR / first paint so the markup hydrates cleanly.
assert.match(
  source,
  /const \[open, setOpen\] = useState\(true\)/,
  "defaults to open for SSR + first client paint (avoids a hydration mismatch)",
);
assert.match(
  source,
  /localStorage\.getItem\(OPEN_STORAGE_KEY\)[\s\S]{0,120}?setOpen\(stored !== "false"\)/,
  "hydrates the saved open/collapsed preference after mount",
);
assert.match(
  source,
  /localStorage\.setItem\(OPEN_STORAGE_KEY, String\(next\)\)/,
  "persists the preference whenever the user toggles the section",
);
assert.match(
  source,
  /onClick=\{toggleOpen\}/,
  "the header toggle writes through the persisting handler",
);

// The always-mounted Workspace/sidebar tree has one session-list owner. The
// Workspace refreshes it every four seconds and passes that state through the
// sidebar; RecentActivityRollup must never add a mount or interval request.
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void loadSessions\(\), 4000, \{\s*pauseWhileInputActive: true,?\s*\}\)/,
  "Workspace owns the four-second session refresh interval",
);
assert.match(
  sidebar,
  /<RecentActivityRollup[\s\S]{0,180}sessions=\{sessions\}[\s\S]{0,120}selectedFamiliarIds=\{selectedFamiliarIds\}/,
  "the mounted sidebar passes Workspace-owned sessions into Recent Activity",
);
assert.match(source, /sessions: SessionRow\[\]/, "Recent Activity requires the shared sessions prop");
assert.match(
  source,
  /familiarInScope\(selectedFamiliarIds, session\.familiarId\)/,
  "Recent Activity filters the shared stream against single- and multi-familiar scope",
);
assert.match(
  source,
  /\[sessions, selectedFamiliarIds\]/,
  "Recent Activity re-derives rows whenever the persistent familiar selection changes",
);
assert.doesNotMatch(source, /fetch\s*\(/, "Recent Activity performs no mount-time session request");
assert.doesNotMatch(source, /usePausablePoll|setInterval|POLL_MS/, "Recent Activity owns no refresh interval");
assert.equal(
  [...workspace.matchAll(/fetch\(`\/api\/sessions\/list\$\{scope\}`/g)].length,
  1,
  "the mounted Workspace/sidebar path has one session-list request per refresh",
);

// Foreground five-minute schedule: Workspace makes one mount request plus 75
// four-second ticks. The removed rollup made one mount request plus 20
// fifteen-second ticks (97 before, 76 after).
const fiveMinutesMs = 5 * 60_000;
const workspaceRequests = 1 + fiveMinutesMs / 4_000;
const removedRollupRequests = 1 + fiveMinutesMs / 15_000;
assert.equal(workspaceRequests, 76, "one Workspace owner makes 76 requests in five foreground minutes");
assert.equal(workspaceRequests + removedRollupRequests, 97, "the previous duplicate schedule made 97 requests");

console.log("recent-activity-rollup.test.ts: ok");
