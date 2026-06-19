// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// The bar has exactly two jobs: chat with familiars (left) and view tasks
// (right). It is a labelled landmark so screen readers can find it.
assert.match(
  source,
  /<nav className="menu-bar" aria-label="Chat with familiars and view tasks">/,
  "renders a labelled menu-bar landmark",
);

// Left group — chat. Includes the full switcher plus a one-click avatar strip
// where clicking an avatar starts a chat with that familiar.
assert.match(
  source,
  /<FamiliarSwitcher[\s\S]*onSelectFamiliar=\{onSelectFamiliar\}/,
  "embeds the familiar switcher for scope/full list",
);
assert.match(
  source,
  /className="menu-bar__familiar focus-ring"[\s\S]*onClick=\{\(\) => onChatWithFamiliar\(f\.id\)\}/,
  "clicking a familiar avatar starts a chat with that familiar",
);
assert.match(
  source,
  /aria-label=\{`Chat with \$\{f\.display_name\}`\}/,
  "each avatar button names the familiar it chats with",
);
assert.match(
  source,
  /computePresence\(\{/,
  "avatars compute presence for the status dot",
);
// The New chat button opens a quick-compose dropdown (a popover) rather than
// starting a chat on the first click.
assert.match(
  source,
  /className="menu-bar__new focus-ring"[\s\S]*aria-haspopup="dialog"/,
  "the New chat button opens a dropdown",
);
assert.match(
  source,
  /<Popover[\s\S]*className="menu-bar__compose"/,
  "the dropdown is a popover anchored to the New chat button",
);
assert.match(
  source,
  /className="menu-bar__compose-select"/,
  "the dropdown has a familiar selector",
);
assert.match(
  source,
  /className="menu-bar__compose-input"/,
  "the dropdown has a compose box",
);
// Submitting with text starts a composed chat; submitting empty opens a blank
// chat with the selected familiar.
assert.match(
  source,
  /if \(prompt\) onComposeChat\(selectedId, prompt\);/,
  "typed text starts a chat that auto-sends the message",
);
assert.match(
  source,
  /else onChatWithFamiliar\(selectedId\);/,
  "an empty box opens a blank chat with the selected familiar",
);

// Right group — tasks. A Tasks button (board) and an Inbox button, each with a
// live count badge that is hidden at zero.
assert.match(
  source,
  /className="menu-bar__task focus-ring"[\s\S]*onClick=\{onViewTasks\}/,
  "the Tasks button jumps to the board",
);
assert.match(
  source,
  /taskCount > 0 \? <span className="menu-bar__badge">\{fmtBadge\(taskCount\)\}<\/span> : null/,
  "the Tasks badge shows the open-task count and hides at zero",
);
assert.match(
  source,
  /onClick=\{onViewInbox\}/,
  "the Inbox button jumps to the inbox",
);
assert.match(
  source,
  /inboxCount > 0 \? \(\s*<span className="menu-bar__badge menu-bar__badge--alert">/,
  "the Inbox badge shows the attention count and hides at zero",
);

// Wiring in the workspace: the bar mounts in the Shell topBar slot with the
// real chat/scope/navigation handlers and live counts.
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*onChatWithFamiliar=\{\(id\) => startFamiliarChat\(id\)\}/,
  "the bar's chat handler starts a real familiar chat",
);
assert.match(
  workspace,
  /onComposeChat=\{\(id, prompt\) => startFamiliarChat\(id, null, prompt\)\}/,
  "the compose handler starts a familiar chat with an initial prompt",
);
assert.match(
  workspace,
  /onViewTasks=\{\(\) => setMode\("board"\)\}/,
  "View tasks switches to the board surface",
);
assert.match(
  workspace,
  /onViewInbox=\{\(\) => setMode\("inbox"\)\}/,
  "View inbox switches to the inbox surface",
);
assert.match(
  workspace,
  /taskCount=\{boardTaskCount\}[\s\S]*inboxCount=\{inboxBadgeCount\}/,
  "the bar is fed the live board task count and inbox badge count",
);

// The board task count is polled from /api/board (open = not done).
assert.match(
  workspace,
  /fetch\("\/api\/board"[\s\S]*\.filter\(\s*\(c\) => c\.status !== "done",?\s*\)\.length/,
  "boardTaskCount counts cards that are not yet done",
);

// Desktop-only: the bar shows ≥1024px (where the mobile .top-bar is hidden).
assert.match(globals, /\.menu-bar \{\s*display: none;/, "menu bar is hidden by default");
assert.match(
  globals,
  /@media \(min-width: 1024px\) \{\s*\.menu-bar \{\s*display: flex;/,
  "menu bar shows on desktop (≥1024px)",
);

console.log("familiar-menu-bar.test.ts: ok");
