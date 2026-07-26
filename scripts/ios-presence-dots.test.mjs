import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/${p}`, import.meta.url), "utf8");

const theme = await read("Theme/Theme.swift");

// Presence maps daemon status strings to the same colours the desktop's
// statusMeta() uses, so the iOS dots match the web.
assert.match(theme, /enum Presence \{/, "Theme should define a Presence helper");
for (const [status, hex] of [
  ["active", "#4ade80"],
  ["idle", "#60a5fa"],
  ["busy", "#fbbf24"],
  ["offline", "#8a8a8e"],
]) {
  assert.match(theme, new RegExp(`"${status}"[\\s\\S]*?Color\\(hex: "${hex}"\\)`), `Presence should map ${status} → ${hex}`);
}
assert.match(theme, /static func color\(for status: String\?\) -> Color\?/, "Presence.color(for:) should exist");

// AvatarView gains an opt-in presence dot.
const avatar = await read("Views/AvatarView.swift");
assert.match(avatar, /var showStatus: Bool = false/, "AvatarView should expose an opt-in showStatus flag");
assert.match(
  avatar,
  /Presence\.color\(for: familiar\?\.status\)/,
  "AvatarView should colour the dot from the familiar's status",
);
assert.match(avatar, /\.overlay\(alignment: \.bottomTrailing\) \{ statusDot \}/, "the dot sits bottom-trailing");

// The 'who's around' surfaces enable the dot.
for (const view of ["ChatsHomeView.swift", "ChatView.swift", "NewChatView.swift"]) {
  const src = await read(`Views/${view}`);
  assert.match(src, /showStatus: true/, `${view} should enable the presence dot`);
}

console.log("ios-presence-dots: ok");
