// @ts-nocheck
// Source pins for the title row's participants cluster (cave-9xadi,
// Chat.dc.html 2a ②). The design states its own intent: "a solo session
// becomes a coven by adding someone here" — so the pins here are about that
// path staying wired, not about pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const participants = read("./chat-participants.tsx");
const chatView = read("./chat-view.tsx");
const router = read("./chat-router.tsx");
const groupView = read("./group-chat-view.tsx");
const events = read("../lib/chat-tab-events.ts");
const css = read("../styles/cave-chat/activity.css");

// ── The cluster leads the title row's action group ──────────────────────────
assert.match(
  chatView,
  /<div className="cave-chat-session-actions">[\s\S]{0,400}?<ChatParticipants/,
  "participants lead the action group — who is here reads before what you can do",
);
assert.match(
  chatView,
  /<ChatParticipants\s*\n\s*familiar=\{familiar\}\s*\n\s*familiars=\{familiars\}\s*\n\s*daemonRunning=\{daemonRunning \?\? null\}\s*\n\s*onAddFamiliar=\{promoteToCoven\}/,
  "the cluster gets the host, the roster it can add from, presence, and the promote handler",
);
assert.match(
  router,
  /<ChatView[\s\S]{0,200}?familiars=\{familiars\}/,
  "ChatRouter forwards the roster — without it the + has nobody to offer",
);

// ── The + is the coven entry point, not decoration ──────────────────────────
assert.match(
  participants,
  /aria-label="Add a familiar to this chat"/,
  "the add control is reachable by name",
);
assert.match(
  participants,
  /className="cave-chat-participants__add focus-ring"/,
  "the add control keeps the shared focus ring",
);
assert.match(
  participants,
  /onSelect=\{\(\) => \{\s*setOpen\(false\);\s*onAddFamiliar\(other\.id\);/,
  "picking a familiar closes the roster and promotes",
);
assert.match(
  participants,
  /addableFamiliars\(familiars, familiar\.id\)/,
  "the roster never offers the familiar you are already talking to",
);
assert.match(
  participants,
  /No other familiars yet/,
  "a single-familiar install gets an explanation, not an empty popover",
);

// ARIA: the trigger promises a menu, so the rows must live in one. menuitems
// outside a menu container are invalid, and a plain button among them makes
// the promise unreliable for screen readers (Copilot review, PR #4127).
assert.match(
  participants,
  /<PopoverBody role="menu" ariaLabel="Add a familiar to this chat">/,
  "the roster body is a menu, matching the trigger's aria-haspopup",
);
assert.doesNotMatch(
  participants,
  /semantic="button"/,
  "every row keeps menuitem semantics; non-actionable rows use `disabled` instead",
);
assert.match(
  participants,
  /aria-haspopup="menu"/,
  "the trigger still advertises the menu it opens",
);

// ── Promotion carries the thread and routes deterministically ───────────────
assert.match(
  chatView,
  /promoteSessionToCoven\(\{\s*groups: loadGroups\(\),/,
  "promotion starts from the persisted groups",
);
assert.match(
  chatView,
  /host: \{ id: familiar\.id, name: familiar\.display_name \},[\s\S]{0,200}?sessionId,/,
  "the current thread is handed to the promotion as the host's session",
);
assert.match(
  chatView,
  /saveGroups\(groups\);\s*\n\s*markCovenTabPending\(\);\s*\n\s*markCovenGroupPending\(group\.id\);/,
  "the group is persisted BEFORE the handoff latches, so the surface can find it",
);
assert.match(
  events,
  /export function markCovenGroupPending[\s\S]*?export function consumeCovenGroupPending/,
  "the coven-group latch is a mark/consume pair like the other tab handoffs",
);
assert.match(
  groupView,
  /const requested = consumeCovenGroupPending\(\);\s*\n\s*const target = requested && loaded\.some\(\(g\) => g\.id === requested\) \? requested : loaded\[0\]\?\.id;/,
  "the coven surface honours the requested group, falling back to the first",
);
assert.doesNotMatch(
  groupView,
  /if \(loaded\.length > 0\) setActiveId\(loaded\[0\]\.id\);/,
  "selecting index 0 unconditionally would drop the user beside the coven they just made",
);

// ── Presence + mode are legible ─────────────────────────────────────────────
assert.match(
  participants,
  /const online = daemonRunning !== false;/,
  "presence tracks the daemon — a familiar is only reachable when it is up",
);
assert.match(
  participants,
  /className="cave-chat-participants__mode">Solo</,
  "the cluster names the current mode; broadcast/round robin belong to the coven surface",
);
assert.match(
  css,
  /\.cave-chat-participants__add \{[\s\S]*?border: 1px dashed var\(--border-strong\);[\s\S]*?border-radius: var\(--radius-pill\);/,
  "the add slot is the design's dashed circle, distinct from the solid verbs beside it",
);
// --accent-presence resolves to a near-white (#ececec) in the codex theme,
// which reads identically to the muted offline dot. The host chip's online
// indicator already solved this with --color-success; match it.
assert.match(
  css,
  /\.cave-chat-participants__presence\[data-online="true"\] \{\s*background: var\(--color-success\);/,
  "the online dot uses the same token as the app's other online indicators",
);
assert.doesNotMatch(
  css,
  /\.cave-chat-participants__presence\[data-online="true"\] \{\s*background: var\(--accent-presence\)/,
  "not --accent-presence: some themes make it indistinguishable from offline",
);

console.log("chat-participants.test.ts: ok");
