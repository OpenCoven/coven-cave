import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const packageJson = JSON.parse(read("package.json"));

const infoPlist = read("src-tauri/gen/apple/app_iOS/Info.plist");
assert.match(infoPlist, /<key>NSLocalNetworkUsageDescription<\/key>/);
assert.match(infoPlist, /CovenCave connects to your private Tailscale network/);
assert.match(infoPlist, /<key>NSBonjourServices<\/key>/);
assert.match(infoPlist, /<string>_tailscale\._tcp<\/string>/);
assert.match(infoPlist, /<string>_tailscale\._udp<\/string>/);
assert.match(infoPlist, /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
assert.match(
  infoPlist,
  /<key>CFBundleURLTypes<\/key>\s*<array>[\s\S]*<key>CFBundleURLSchemes<\/key>\s*<array>[\s\S]*<string>opencoven<\/string>[\s\S]*<\/array>[\s\S]*<\/array>/,
  "iOS Info.plist should register the opencoven URL scheme",
);

const sourceInfoPlist = read("src-tauri/Info.ios.plist");
assert.equal(sourceInfoPlist.trimEnd(), infoPlist.trimEnd());

const entitlements = read("src-tauri/gen/apple/app_iOS/app_iOS.entitlements");
assert.match(entitlements, /com\.apple\.developer\.networking\.wifi-info/);

const libRs = read("src-tauri/src/lib.rs");
assert.match(libRs, /CAVE_MOBILE_DEV_URL/);
assert.match(libRs, /\.ts\.net/);
assert.match(libRs, /WebviewUrl::External/);
assert.match(libRs, /127\.0\.0\.1/);
assert.match(libRs, /cfg!\(debug_assertions\)/);
assert.match(libRs, /WebviewUrl::App\("index\.html"\.into\(\)\)/);

const swiftRootView = read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
assert.match(
  swiftRootView,
  /case \.unreachable:\s*\n\s*ConnectionView\(\)/,
  "native SwiftUI app should return unreachable saved hosts to the connection screen",
);

const swiftChatThread = read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
assert.match(
  swiftChatThread,
  /func deleteMessage\(_ messageId: String\)/,
  "native SwiftUI chat threads should expose a persisted message deletion method",
);
assert.match(
  swiftChatThread,
  /messages\.removeAll\s*\{\s*\$0\.id == messageId\s*\}/,
  "native SwiftUI chat message deletion should remove the selected message by id",
);
assert.match(
  swiftChatThread,
  /case \.assistantChunk\(let chunk\):\s*\n\s*mutate\(messageId\) \{ \$0\.text \+= chunk \}\s*\n\s*onChange\(\)/,
  "native SwiftUI chat should notify/persist after assistant chunks so responses render while streaming",
);
assert.match(
  swiftChatThread,
  /var message = messages\[idx\][\s\S]*?body\(&message\)[\s\S]*?messages\[idx\] = message/,
  "native SwiftUI chat should reassign mutated messages so Observation invalidates rendered bubbles",
);

const swiftMessageBubble = read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");
assert.match(
  swiftMessageBubble,
  /var onDelete: \(\) -> Void/,
  "native SwiftUI message bubbles should accept a delete action from the owning thread",
);
assert.match(
  swiftMessageBubble,
  /\.contextMenu\s*\{/,
  "native SwiftUI message bubbles should expose deletion from the bubble context menu",
);
assert.match(
  swiftMessageBubble,
  /role: \.destructive[\s\S]*?Delete Message/,
  "native SwiftUI message deletion should be labeled and destructive",
);

const swiftChatView = read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
assert.match(
  swiftChatView,
  /onDelete:\s*\{\s*deleteMessage\(message\)\s*\}/,
  "native SwiftUI chat view should wire each bubble delete action to the owning thread",
);
assert.match(
  swiftChatView,
  /private func deleteMessage\(_ message: DisplayMessage\)/,
  "native SwiftUI chat view should persist after deleting a message",
);

const swiftCaveClient = read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
assert.match(
  swiftCaveClient,
  /if let event = StreamEvent\.decode\(payload\) \{\s*\n\s*continuation\.yield\(event\)\s*\n\s*continue\s*\n\s*\}/,
  "native SwiftUI SSE parser should decode single data payloads immediately instead of depending on blank-frame boundaries",
);
assert.match(
  swiftCaveClient,
  /let trimmedLine = line\.trimmingCharacters\(in: \.whitespacesAndNewlines\)[\s\S]*?if trimmedLine\.isEmpty/,
  "native SwiftUI SSE parser should treat whitespace-only separator lines as event boundaries",
);

const swiftCodeEditorView = read("apps/ios/CovenCave/CovenCave/Views/CodeEditorView.swift");
assert.match(
  swiftCodeEditorView,
  /MarkdownWebView\(markdown: codeMarkdown\(for: loaded\), height: \$previewHeight\)/,
  "native SwiftUI code editor should render read-only text through the bundled markdown highlighter",
);
assert.match(
  swiftCodeEditorView,
  /if editing \{[\s\S]*?TextEditor\(text: \$text\)/,
  "native SwiftUI code editor should keep TextEditor for editable text",
);
assert.match(
  swiftCodeEditorView,
  /private func codeMarkdown\(for loaded: FileContent\) -> String/,
  "native SwiftUI code editor should build fenced markdown for highlighted code previews",
);
assert.match(
  swiftCodeEditorView,
  /private func codeFence\(for value: String\) -> String/,
  "native SwiftUI code editor should choose a safe fence for code containing backticks",
);
assert.match(
  swiftCodeEditorView,
  /private func languageForCodeFence\(_ filename: String\) -> String/,
  "native SwiftUI code editor should infer a highlighter language from the filename",
);

const frontendStub = read("src-tauri/frontend-stub/index.html");
assert.match(frontendStub, /Connect to CovenCave/);
assert.match(frontendStub, /coven-cave:mobile-server-url/);
assert.match(frontendStub, /window\.location\.assign/);
assert.doesNotMatch(frontendStub, /Loading CovenCave/);

const mobileScript = read("scripts/mobile-tailscale.sh");
assert.match(mobileScript, /native_command\(\)/);
assert.match(mobileScript, /HOME\/\.cargo\/bin/);
assert.match(mobileScript, /ios\s+dev\s+--no-dev-server-wait/);
assert.match(mobileScript, /--no-dev-server-wait/);
assert.match(mobileScript, /beforeDevCommand/);
assert.match(mobileScript, /const devUrl = process\.argv\[2\]/);
assert.match(mobileScript, /"\$tauri_config"/);
assert.match(mobileScript, /resolve_ios_device_name/);
assert.match(mobileScript, /pnpm exec tauri "\$\{tauri_args\[@\]\}"/);
assert.doesNotMatch(mobileScript, /tauri ios dev --device/);

// Native mode uses a sidecar auth token (COVEN_CAVE_AUTH_TOKEN), persisted in the state dir,
// to authenticate the in-app webview instead of running fully ungated. This satisfies the
// in-app SidecarAuthMonitor and gates /api/ over Tailscale.
assert.match(mobileScript, /SIDECAR_TOKEN_FILE=/);
assert.match(mobileScript, /load_or_create_sidecar_token\(\)/);
// The native (webview) server is started WITH the sidecar auth token set; it
// must NOT run tokenless. The ONLY launch path that unsets both token vars is
// the separate tokenless native-app mode (CAVE_MOBILE_APP /
// `pnpm mobile:tailscale:app`), which is distinguished by also unsetting
// COVEN_CAVE_BUNDLE. So: assert the native path keeps the sidecar token, and
// that every "unset both tokens" occurrence belongs to that app mode.
assert.match(mobileScript, /COVEN_CAVE_AUTH_TOKEN/);
assert.match(mobileScript, /export COVEN_CAVE_AUTH_TOKEN=/);
for (const m of mobileScript.matchAll(/unset COVEN_CAVE_ACCESS_TOKEN COVEN_CAVE_AUTH_TOKEN[^\n;]*/g)) {
  assert.match(m[0], /COVEN_CAVE_BUNDLE/, "only the tokenless app mode may unset both tokens together");
}
for (const m of mobileScript.matchAll(/-u COVEN_CAVE_ACCESS_TOKEN -u COVEN_CAVE_AUTH_TOKEN[^\n]*/g)) {
  assert.match(m[0], /-u COVEN_CAVE_BUNDLE/, "only the tokenless app mode may unset both tokens together");
}
// The dev URL handed to the webview carries the token so SidecarAuthBridge
// stores it and authenticates every /api/ request.
assert.match(mobileScript, /covenCaveToken/);
// The token MUST ride in the URL hash, not the query string: a query string on
// the dev document URL corrupts Turbopack dev chunk URLs in the iOS WKWebView
// (chunks resolve to /?covenCaveToken=.../_next/... → HTML → no hydration →
// blank shell). The hash is excluded from chunk URL resolution.
assert.match(mobileScript, /url\.hash = new URLSearchParams\(\{ covenCaveToken: token \}\)/);
assert.doesNotMatch(mobileScript, /searchParams\.set\("covenCaveToken"/);
// The mobile access secret stays unset in native mode (Tailscale Serve proxies
// to loopback, so the host gate already passes without it).
assert.match(mobileScript, /unset COVEN_CAVE_ACCESS_TOKEN;/);

assert.equal(
  packageJson.scripts["mobile:tailscale:native"],
  "bash scripts/mobile-tailscale.sh native",
);
