import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const chatView = read("./chat-view.tsx");
const groupChat = read("./group-chat-view.tsx");
const avatar = read("./user-chat-avatar.tsx");

describe("operator profile consumption", () => {
  it("chat turn labels route through userDisplayName, not hard-coded You", () => {
    assert.match(chatView, /userDisplayName\(/);
    assert.doesNotMatch(chatView, /turn\.role === "system" \? "System" : "You"/);
  });
  it("group chat roster + turn name use the profile name", () => {
    assert.match(groupChat, /userDisplayName\(/);
    assert.doesNotMatch(groupChat, /name: "You"/);
  });
  it("user avatar renders the server image and opens Settings instead of inline upload", () => {
    assert.match(avatar, /userAvatarUrl/);
    assert.doesNotMatch(avatar, /setUserAvatarImage/);
    assert.doesNotMatch(avatar, /<input/);
  });
});
