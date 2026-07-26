// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// SessionChangesInner — the embeddable working-tree diff review (chat code
// rail's Changes tab). Formerly pinned via comux-view-changes.test.ts; the
// ComuxView host was deleted (cave-c3yt) and the live pins moved here.

const changes = await readFile(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");

// The reusable inner panel is exported for embedding.
assert.match(
  changes,
  /export function SessionChangesInner\(\{\s*projectRoot,\s*running/,
  "SessionChangesInner must be exported so other surfaces can embed the diff review",
);

// Jump-to-diff: SessionChangesInner accepts focusPath/focusNonce and expands the
// matching file's diff (repo-relative or suffix match) when a transcript edit
// tool is clicked.
assert.match(changes, /focusPath\?: string \| null;/, "SessionChangesInner takes a focusPath prop");
// cave-bvbw moved the raw endsWith pair to a /-boundary suffix helper so
// sibling files with a common string suffix can't cross-match.
assert.match(
  changes,
  /suffixMatch\(focusPath, f\.path\) \|\| suffixMatch\(f\.path, focusPath\)/,
  "focusPath matches repo-relative or absolute paths by /-boundary suffix",
);

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
assert.match(chatView, /const isEditTool = inputDiff != null/, "ToolBlock detects edit tools by their input diff");
assert.match(
  chatView,
  /isEditTool \? "cave:open-file-diff" : "cave:open-project-file"/,
  "edit tools jump to the diff; other file tools open the preview",
);

// ── 2026-07-03 code-surface audit (perf): changes poll content guard ─────────
assert.match(changes, /import \{ arrayContentEqual \} from "@\/lib\/array-content-equal"/, "changes panel imports the content-equality guard");
assert.match(changes, /setFiles\(\(prev\) => \(arrayContentEqual\(prev, nextFiles\) \? prev : nextFiles\)\)/, "the 5s changes poll keeps the previous reference when the diff is unchanged");
// ── 2026-07-03 code a11y batch ────────────────────────────────────────────────
assert.match(changes, /const \{ announce \} = useAnnouncer\(\)/, "the changes panel consumes the announcer");
assert.match(changes, /announce\("Changes committed\."\)/, "committing announces");
assert.match(changes, /announce\("Pull request opened\."\)/, "opening a PR announces");
assert.match(changes, /announce\("File reverted/, "reverting announces");

console.log("session-changes-inner.test.ts: ok");
