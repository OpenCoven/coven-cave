// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./user-chat-avatar.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const group = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");

assert.match(component, /useUserProfile\(/, "component subscribes to the server profile store");
assert.match(component, /userAvatarUrl\(snapshot\)/, "server avatar URL renders from the profile snapshot");
assert.match(component, /<img[\s\S]*src=\{src\}/, "server image renders inside the chat avatar");
assert.doesNotMatch(component, /type="file"|<input|prepareFamiliarImage|setUserAvatarImage/, "avatar no longer owns inline upload UI");
assert.match(component, /window\.location\.assign\("\/settings#profile"\)/, "click opens Settings at the Profile section via the existing hash deep-link route");
assert.doesNotMatch(component, /AvatarMigration|avatar-migrate/, "legacy avatar migration hook is retired");
assert.match(component, /name\.slice\(0, 1\)\.toUpperCase\(\)/, "named profiles can fall back to an initial when no server avatar exists");

assert.match(chat, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Chat imports the user avatar component");
assert.match(chat, /<UserChatAvatar className="cave-linear-turn-avatar cave-linear-turn-avatar--human"/, "Chat user turns render the clickable user avatar");
assert.match(group, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Group chat imports the user avatar component");
assert.match(group, /<UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human"/, "Group user turns render the clickable user avatar");

// The operator photo fills its ring edge-to-edge, so at the familiars' 28px it
// reads a size up from their inset 22px glyphs. The human ring renders at that
// optical 22px (32px on the roomier mobile column), centered on the same axis.
const css = readFileSync(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.cave-linear-turn-avatar--human \{[^}]*width: 22px;[^}]*height: 22px;[^}]*\}/,
  "solo-chat human avatar ring is compact (22px) to match the familiars' inset glyph size",
);
assert.match(
  css,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-linear-turn-avatar--human \{[^}]*width: 32px;[^}]*height: 32px;[^}]*\}/,
  "mobile keeps the human ring proportionally inset (32px in the 38px column)",
);
assert.match(
  css,
  /\.cave-linear-turn-avatar--human svg \{[^}]*width: 14px;[^}]*height: 14px;[^}]*\}/,
  "the ph:user fallback glyph scales down to the compact ring",
);

console.log("user-chat-avatar.test.ts: ok");
