// @ts-nocheck
// Source pins for the composer git chip: chats rooted in a git repo show
// branch · dirty count · worktree · PR context in the composer control row,
// like a modern coding CLI's status line; git-less chats show nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chip = readFileSync(new URL("./composer-git-chip.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const summary = readFileSync(new URL("../lib/use-changes-summary.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/composer-git-chip.css", import.meta.url), "utf8");

// ── The chat composer renders the chip from the chat's active project root ──
assert.match(
  chatView,
  /<ComposerGitChip projectRoot=\{activeProjectRoot\} onOpenUrl=\{onOpenUrl\} \/>/,
  "the chat composer renders the git chip wired to the resolved project root",
);

// ── Git-less chats render nothing — the chip gates on a loaded repo status ──
assert.match(
  chip,
  /if \(!root \|\| !loaded \|\| notARepo \|\| !branch\) return null;/,
  "the chip only appears for chats whose root is a git repo with a branch",
);

// ── Status rides the existing /api/changes poll, not a new endpoint ─────────
assert.match(
  chip,
  /useChangesSummary\(root, Boolean\(root\)\)/,
  "branch/worktree/dirty state come from the shared changes-summary hook",
);
assert.match(
  summary,
  /worktree: string \| null;/,
  "the changes summary carries the linked-worktree name",
);

// ── PR lookup is once-per-(root, branch), never on the 5s poll ──────────────
assert.match(
  chip,
  /const key = `\$\{projectRoot\}\\n\$\{branch\}`;\s*\n\s*if \(fetchedKey\.current === key\) return;/,
  "the PR fetch is keyed by (projectRoot, branch) so the status poll can't re-trigger it",
);
assert.match(
  chip,
  /\/api\/changes\?projectRoot=\$\{encodeURIComponent\(projectRoot\)\}&pr=1/,
  "the PR context comes from the changes route's ?pr=1 query",
);

// ── Selecting the chip opens the Git/Changes panel for this chat ─────────────
assert.match(
  chip,
  /window\.dispatchEvent\(new CustomEvent\("cave:changes-open"\)\);/,
  "selecting the git chip dispatches cave:changes-open to open the changes surface",
);
assert.match(
  chip,
  /role="button"[\s\S]*tabIndex=\{0\}[\s\S]*onClick=\{\(\) => openChanges\(\)\}[\s\S]*onKeyDown=\{onChipKeyDown\}/,
  "the root git chip is keyboard-focusable and actionable",
);

// ── The PR segment remains interactive and does not trigger chip selection ───
assert.match(
  chip,
  /onClick=\{\(event\) => \{\s*\n\s*event\.stopPropagation\(\);[\s\S]*if \(onOpenUrl\) onOpenUrl\(pr\.url\);\s*\n\s*else window\.open\(pr\.url, "_blank", "noopener,noreferrer"\);/,
  "clicking the PR opens it via the app URL handler and does not bubble to chip-open",
);

// ── Long branch names ellipsize instead of blowing up the control row ───────
assert.match(
  css,
  /\.cave-composer-git-chip__label \{[\s\S]*?text-overflow: ellipsis;/,
  "branch/worktree labels truncate with an ellipsis",
);

console.log("composer-git-chip.test.ts: ok");
