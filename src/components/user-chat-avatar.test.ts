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
assert.match(component, /runUserAvatarMigration\(/, "component kicks off the one-time legacy avatar migration");
assert.match(component, /name\.slice\(0, 1\)\.toUpperCase\(\)/, "named profiles can fall back to an initial when no server avatar exists");

assert.match(chat, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Chat imports the user avatar component");
assert.match(chat, /<UserChatAvatar className="cave-linear-turn-avatar cave-linear-turn-avatar--human"/, "Chat user turns render the clickable user avatar");
assert.match(group, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Group chat imports the user avatar component");
assert.match(group, /<UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human"/, "Group user turns render the clickable user avatar");

console.log("user-chat-avatar.test.ts: ok");
