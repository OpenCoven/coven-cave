// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./familiar-inline-card.tsx", import.meta.url), "utf8");

assert.match(src, /export function FamiliarInlineCard/, "exports FamiliarInlineCard");

// Identity section: enlarged avatar + name + role + description
assert.match(src, /FamiliarAvatar/, "renders FamiliarAvatar");
assert.match(src, /size="xl"/, "uses xl avatar size");
assert.match(src, /display_name/, "shows display_name");
assert.match(src, /\.role/, "shows role");
assert.match(src, /description/, "shows description");

// Presence/status section
assert.match(src, /useFamiliarStatus/, "uses status hook");
assert.match(src, /statusMeta/, "maps status via statusMeta");
assert.match(src, /formatRelTime/, "formats last-seen");

// Quick actions: scope switch, studio, edit profile, new chat
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*\)/, "Open Studio action");
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*,\s*"identity"\s*\)/, "Edit profile → identity tab");
assert.match(src, /cave:familiar-select/, "Switch dispatches cave:familiar-select");
assert.match(src, /cave:agents-new-chat/, "New chat dispatches cave:agents-new-chat");

// The enlarged avatar preview allows editing too — an "Edit profile" footer
// action inside the lightbox, targeting the same Studio identity tab.
assert.match(src, /expandFooterActions=\{/, "expandable avatar carries footer actions");
assert.match(
  src,
  /expandFooterActions=\{[\s\S]*?openFamiliarStudio\(familiar\.id, "identity"\)[\s\S]*?Edit profile/,
  "lightbox footer action opens the Studio identity tab to edit the profile",
);

// Deep memory peek + view-all link
assert.match(src, /useFamiliarMemory/, "uses memory hook");
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*,\s*"memory"\s*\)/, "View all → memory tab");
assert.match(src, /__memory-stale/, "stale memory entries carry a badge");

// ── Insight layer (cave-ck70) ───────────────────────────────────────────────
// Trust/health one-liner, activity meta, live workload, contextual actions —
// derived by familiar-card-insights from the shared analytics model.
assert.match(src, /useCardInsights/, "uses insights hook");
assert.match(src, /deriveFamiliarCardInsights/, "derives insights from the analytics model");
assert.match(src, /loadFamiliarAnalyticsData/, "reuses the analytics loader, not a bespoke fan-out");
assert.match(src, /__insight/, "renders the trust/health insight line");
assert.match(src, /data-tone=\{insights\.insight\.tone\}/, "insight line is tone-tinted");
assert.match(src, /insightsCache\.delete/, "failed insight loads are NOT cached (cave-2ex2)");
assert.match(src, /runningSessions\.map/, "live workload lists running sessions");
assert.match(src, /cave:agents-open-session/, "workload rows open their session");
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*,\s*"contract"\s*\)/, "fix-contract action → contract tab");
assert.match(src, /insights\?\.actions\.map/, "state-driven actions render ahead of the static row");
assert.match(src, /sessionsLast7d/, "shows 7-day session pulse");
assert.match(src, /topSignal/, "surfaces the top growth signal");

// a11y + dismiss affordance
assert.match(src, /aria-label="Close"/, "close button labelled");
assert.match(src, /onClose/, "accepts onClose");

// endpoints reused, not reinvented
assert.match(src, /\/api\/familiars/, "fetches /api/familiars");
assert.match(src, /\/api\/memory/, "fetches /api/memory");

// loading + empty handling for memory
assert.match(src, /No memory yet/, "empty memory state");

// ── CSS regression: the expanded card must escape the avatar circle ─────────
// The card mounts inside `.cave-linear-turn-avatar`, whose `overflow: hidden`
// (there to crop photo avatars) used to clip the whole card down to the 48px
// circle — only its close × peeked through. The crop now lives on the inner
// button, the cell un-clips when it hosts the button, and the card floats as
// an absolutely positioned popover above the following turns.
const css = ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
assert.match(
  css,
  /\.cave-linear-turn-avatar:has\(> \.cave-linear-turn-avatar-btn\) \{\s*overflow: visible;/,
  "avatar cell un-clips when it hosts the interactive button",
);
assert.match(
  css,
  /\.cave-linear-turn-avatar-btn \{[^}]*border-radius: inherit;[^}]*overflow: hidden;/,
  "photo crop moved onto the avatar button",
);
assert.match(
  css,
  /\.familiar-inline-card \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 8px\);[^}]*z-index/s,
  "card is an absolutely positioned popover below the avatar",
);
assert.match(
  css,
  /\.cave-linear-turn-avatar\.is-selected \{[^}]*z-index/,
  "open card stacks above the following turns",
);

console.log("familiar-inline-card.test.ts: ok");
