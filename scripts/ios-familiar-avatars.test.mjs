import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// Source-invariant pins for familiar avatars on iOS (#5714). The server serves
// workspace avatars from the gated `/api/familiars/<id>/avatar` route, so a
// bare, unauthenticated URL renders initials on every non-loopback connection
// (a phone over Tailscale). Every familiar avatar must go through the
// credential-aware `familiarAvatarSource(for:)`.

const root = new URL("../apps/ios/CovenCave/CovenCave/", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");

const client = await read("Networking/CaveClient.swift");
const start = client.indexOf("func familiarAvatarSource(");
assert.ok(start > 0, "CaveClient exposes familiarAvatarSource(for:)");
const helper = client.slice(start, client.indexOf("struct FamiliarAvatarMutation", start));
assert.match(
  helper,
  /func familiarAvatarSource\(\s*for familiar: Familiar,\s*credential: \(URL\) throws -> String\? = \{ try CaveConnection\.imageCredentials\.credential\(for: \$0\) \}\s*\) -> CaveImageSource\?/,
  "returns an image source, not a bare URL",
);
assert.match(
  helper,
  /try credential\(url\)[\s\S]*?\.authenticatedRemoteURL\(url, bearerToken: token\)/,
  "the Cave host's avatar route carries the header credential",
);
assert.match(
  helper,
  /guard let base = connection\.baseURL, Self\.isSameOrigin\(url, base\) else \{ return \.remoteURL\(url\) \}/,
  "a foreign absolute avatar URL never receives the credential",
);
assert.doesNotMatch(helper, /coven_access_token|try\?/, "no URL credentials or silent auth downgrade");
assert.match(helper, /catch \{\s*return nil/, "credential failures use the initials fallback");

// No view may hand AvatarView an unauthenticated familiar URL.
const viewsDir = new URL("Views/", root);
const swiftFiles = [];
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) await walk(child);
    else if (entry.name.endsWith(".swift")) swiftFiles.push(child);
  }
};
await walk(viewsDir);
for (const file of swiftFiles) {
  const text = await readFile(file, "utf8");
  assert.doesNotMatch(
    text,
    /avatarURL\(for:/,
    `${file.pathname.split("/Views/")[1]} must use familiarAvatarSource(for:), not avatarURL(for:)`,
  );
  assert.doesNotMatch(
    text,
    /avatarUrl\.flatMap\(URL\.init\(string:\)\)/,
    `${file.pathname.split("/Views/")[1]} must not resolve a relative avatar path without the host`,
  );
}

// Group surfaces that previously passed no image at all.
const avatar = await read("Views/AvatarView.swift");
assert.match(avatar, /var source: \(Familiar\) -> CaveImageSource\? = \{ _ in nil \}/, "cluster resolves member avatars");
assert.match(avatar, /AvatarView\(familiar: fam, source: source\(fam\), size: size \* 0\.62\)/, "cluster passes each member's source");

const home = await read("Views/ChatsHomeView.swift");
assert.match(
  home,
  /AvatarClusterView\(familiars: familiars, size: 48,\s*source: \{ app\.client\?\.familiarAvatarSource\(for: \$0\) \}\)/,
  "group thread rows show real avatars",
);

const bubble = await read("Views/MessageBubble.swift");
assert.match(bubble, /AvatarView\(familiar: familiar, source: familiarAvatarSource, size: 28\)/, "group bubbles show the familiar's avatar");
assert.match(bubble, /lhs\.familiarAvatarSource == rhs\.familiarAvatarSource/, "credential rotation invalidates the bubble's image source");

const chat = await read("Views/ChatView.swift");
assert.match(
  chat,
  /let bubbleAvatarSource: CaveImageSource\? = thread\.isGroup\s*\?\s*bubbleFamiliar\.flatMap \{ app\.client\?\.familiarAvatarSource\(for: \$0\) \}\s*:\s*nil[\s\S]*?familiarAvatarSource: bubbleAvatarSource,/,
  "ChatView resolves the bubble avatar only for group threads, where it renders",
);
assert.match(chat, /LiveVoiceCallView\(model: model,\s*avatarSource: app\.client\?\.familiarAvatarSource\(for: model\.familiar\)\)/, "voice call header gets the authenticated avatar");

const voice = await read("Views/Voice/LiveVoiceCallView.swift");
assert.match(voice, /AvatarView\(familiar: model\.familiar,\s*source: avatarSource,/, "voice call renders the passed source");

console.log("ios-familiar-avatars: ok");
