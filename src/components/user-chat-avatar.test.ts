// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./user-chat-avatar.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const group = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");

assert.match(component, /useUserAvatarImage/, "component subscribes to the user avatar image store");
assert.match(component, /prepareFamiliarImage/, "component reuses the existing avatar preparation/downsize path");
assert.match(component, /type="file"[\s\S]*FAMILIAR_IMAGE_ACCEPT/, "clicking the avatar opens an image file picker");
assert.match(component, /setUserAvatarImage\(prepared\)/, "prepared image is persisted as the user avatar");
assert.match(component, /<img[\s\S]*avatar\.dataUrl/, "stored image renders inside the chat avatar");
assert.match(component, /aria-label=\{ariaLabel \?\? "Set your chat avatar"\}/, "button exposes upload intent");

assert.match(chat, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Chat imports the user avatar component");
assert.match(chat, /<UserChatAvatar className="cave-linear-turn-avatar cave-linear-turn-avatar--human"/, "Chat user turns render the clickable user avatar");
assert.match(group, /import \{ UserChatAvatar \} from "@\/components\/user-chat-avatar"/, "Group chat imports the user avatar component");
assert.match(group, /<UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human"/, "Group user turns render the clickable user avatar");

console.log("user-chat-avatar.test.ts: ok");
