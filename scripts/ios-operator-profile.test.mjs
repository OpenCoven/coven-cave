import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source-invariant pins for the iOS operator-profile feature (cave-8xb): iOS
// reads GET /api/profile and shows the operator's name/avatar in chat instead
// of a generic "You". These guard the wiring against silent regressions.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const profile = await read("apps/ios/CovenCave/CovenCave/State/OperatorProfile.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const bubble = await read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");
const avatar = await read("apps/ios/CovenCave/CovenCave/Views/AvatarView.swift");
const chatsHome = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

// --- Model: decodes the /api/profile envelope, falls back to "You" -----------
assert.match(profile, /struct OperatorProfileResponse: Decodable/, "response envelope is decodable");
assert.match(profile, /struct Avatar: Decodable \{[\s\S]*?var present: Bool[\s\S]*?var updatedAt: String\?/, "avatar metadata is decoded");
assert.match(
  profile,
  /return trimmed\.isEmpty \? "You" : trimmed/,
  "displayName falls back to \"You\" when the name is empty (empty profile reads as before)",
);

// --- Client: GET /api/profile + a query-authed avatar URL --------------------
assert.match(client, /func operatorProfile\(\) async throws -> OperatorProfile/, "client fetches the profile");
assert.match(client, /request\("api\/profile"\)/, "hits GET /api/profile");
assert.match(client, /func operatorAvatarURL\(updatedAt: String\?\) -> URL\?/, "builds the avatar image URL");
assert.match(
  client,
  /URLQueryItem\(name: "coven_access_token", value: token\)/,
  "attaches the access token as a query param so a header-less image load still authenticates",
);
assert.match(
  client,
  /URLQueryItem\(name: "v", value: updatedAt\)/,
  "cache-busts the avatar by the profile's updatedAt",
);

// --- AppModel: state, helpers, and hydration on connect/foreground -----------
assert.match(model, /var operatorProfile: OperatorProfile\?/, "AppModel holds the operator profile");
assert.match(model, /var operatorDisplayName: String \{ operatorProfile\?\.displayName \?\? "You" \}/, "display-name helper");
assert.match(model, /func loadOperatorProfile\(\) async/, "load method exists");
assert.match(model, /if operatorProfile != profile \{ operatorProfile = profile \}/, "assign-on-change (no needless invalidation)");
// Hydrated on the connect path, on a full surface refresh, and on foreground.
const loadCalls = model.match(/await loadOperatorProfile\(\)/g) ?? [];
assert.ok(loadCalls.length >= 3, `loadOperatorProfile is called on connect, refresh, and foreground (found ${loadCalls.length})`);

// --- Chat: "You" author labels route through the operator name ---------------
assert.match(
  chatView,
  /case \.user: return app\.operatorDisplayName/,
  "reply author uses the operator name, not a hard-coded You",
);
assert.match(
  chatView,
  /case \.user:\s*\n\s*return app\.operatorDisplayName/,
  "forward sender uses the operator name",
);
assert.match(
  chatView,
  /operatorName: app\.operatorDisplayName,\s*\n\s*operatorAvatarURL: app\.operatorAvatarURL/,
  "the message bubble receives the operator name + avatar",
);
assert.match(chatsHome, /\\\(app\.operatorDisplayName\): /, "chat-list preview prefixes user turns with the operator name");

// The markdown export sentinel stays "You" (round-trips with the importer).
assert.match(model, /case \.user: who = "You"/, "export keeps the You/System sentinels for round-tripping");

// --- Bubble + avatar: operator gets a name row + avatar in group threads ------
assert.match(bubble, /var operatorName: String = "You"/, "bubble defaults operatorName to You");
assert.match(
  bubble,
  /if isUser, isGroup \{\s*\n\s*AvatarView\(familiar: nil, url: operatorAvatarURL, size: 28, fallbackName: operatorName\)/,
  "operator avatar renders at the trailing edge in group threads",
);
assert.match(avatar, /var fallbackName: String\? = nil/, "AvatarView gained a fallbackName for the record-less operator");
assert.match(
  avatar,
  /Theme\.initials\(familiar\?\.displayName \?\? fallbackName \?\? "\?"\)/,
  "initials fall back to the operator name when there is no Familiar",
);

console.log("ios-operator-profile.test.mjs: ok");
