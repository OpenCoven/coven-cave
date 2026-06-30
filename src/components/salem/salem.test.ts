// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../..");

// 1. Salem's 2D cat avatar (the heavy Three.js scene was removed to drop the
//    `three` dependency). It must stay a flat, dependency-free avatar that
//    still reads as a black cat on dark chrome and handles all four moods.
const cat = await readFile(path.join(root, "src/components/salem/salem-cat.tsx"), "utf8");
assert.match(cat, /export function SalemCat\b/, "must export the 2D SalemCat");
assert.doesNotMatch(cat, /from "three"/, "2D cat must NOT import Three.js");
assert.doesNotMatch(cat, /canvas|WebGL|SphereGeometry/i, "2D cat must not use a WebGL canvas");
assert.match(cat, /"ph:cat"/, "2D cat must render the Phosphor cat glyph");
assert.match(cat, /idle[\s\S]*thinking[\s\S]*happy[\s\S]*listening/, "must handle all four moods");
assert.match(cat, /rim|accent-presence/i, "black cat must keep a colored rim for contrast on dark chrome");

// 2. SalemChatPanel wires chat + API. The floating perch was removed; Salem
//    stays available through the companion sidepanel and context-aware search.
const widget = await readFile(path.join(root, "src/components/salem/salem-widget.tsx"), "utf8");
assert.doesNotMatch(widget, /<SalemCat\b|from "\.\/salem-cat"/, "sidepanel header no longer embeds the cat avatar");
assert.doesNotMatch(widget, /SalemCat3D|from "three"/, "widget must not reference the removed 3D cat or three");
assert.match(widget, /SalemChatPanel/, "must export SalemChatPanel for the right rail");
assert.doesNotMatch(widget, /export function SalemWidget|type SalemWidgetProps|salem-perch|--salem-proximity/, "floating Salem widget/perch should stay removed");
assert.match(widget, /\/api\/salem/, "widget must call /api/salem");
assert.match(widget, /salem-panel--rail/, "chat must render in the shell right panel");
assert.match(
  widget,
  /className="salem-panel__send"[\s\S]*?<Icon name="ph:paw-print-fill"/,
  "Salem chat send control must be an icon-only paw button",
);
assert.doesNotMatch(widget, /salem-panel__send-text|>SALEM</, "Salem chat send control must not render a clipped text label");
assert.doesNotMatch(widget, /salem-msg__glyph|🐱|😅/, "open Salem chat must not render emoji glyphs");

// 3. Salem preload context exists
const context = await readFile(path.join(root, "src/components/salem/salem-context.ts"), "utf8");
assert.match(context, /SALEM_PRELOAD_CONTEXT/, "must export Salem preload context");
assert.match(context, /docsCorpus/, "must preload docs corpus context");
assert.match(context, /toolLoadout/, "must preload tool loadout context");
assert.match(context, /skillLoadout/, "must preload skill loadout context");
assert.match(context, /routeContext/, "must preload Cave route context");
assert.match(context, /Ask Molty/, "must preserve Ask Molty docs-agent lineage");
assert.match(context, /Male black cat/, "must preserve Salem's male black cat persona");
assert.match(context, /Sabrina the Teenage Witch/, "must preserve Salem's Sabrina inspiration");
assert.match(context, /he\/him/, "must use he/him pronouns for Salem");

// 4. Salem API route exists
const route = await readFile(path.join(root, "src/app/api/salem/route.ts"), "utf8");
assert.match(route, /POST/, "must export POST handler");
assert.match(route, /GET/, "must expose preloaded context to the widget");
assert.match(route, /SALEM_PRELOAD_CONTEXT/, "must use shared preload context");
assert.match(route, /CHAT_API_CONNECT_TIMEOUT_MS\s*=\s*20_000/, "Salem upstream chat API connect timeout must allow the hosted stream to start");
assert.match(route, /CHAT_API_TIMEOUT_MS\s*=\s*45_000/, "Salem upstream chat API stream timeout must allow full hosted replies");
assert.doesNotMatch(route, /const connectTimeoutMs = 2_500/, "Salem must not abort the upstream chat API before it can stream");
assert.match(route, /type SalemSearchContext/, "Salem API should accept structured local search context");
assert.match(route, /formatSearchContextForPrompt\(context\)/, "Salem API should format top-bar search context into the hosted prompt");
assert.match(route, /askChatApiContext\(messageForApi\)/, "Cave Salem should ask the hosted chat-api for retrieved docs context, not hosted synthesis");
assert.match(route, /askLocalFamiliar\([\s\S]*?familiarId[\s\S]*?model/, "Cave Salem must synthesize through the local familiar so the user's connected model pays for the run");
assert.match(route, /modelOverride:\s*args\.model/, "local Salem synthesis must forward the exact selected model as a next-message override");
assert.match(route, /modelOverrideScope:\s*"next-message"/, "Salem must not persist the one-off model override as a session default");
assert.match(route, /askChatApiAnswer\(messageForApi\)/, "Salem must keep a hosted-answer fallback when the backend does not serve context mode, so it never regresses to weak local retrieval");
assert.match(route, /localContextUsed/, "Salem API response should disclose whether local context was included");
assert.match(route, /familiar|familiar/, "must know about familiars");
assert.match(route, /role|Role/, "must know about roles");
assert.match(route, /plugin|Plugin/, "must know about plugins");
assert.match(route, /Male black cat/, "must answer with Salem's persona");
assert.doesNotMatch(route, /🐱|😅/, "Salem API replies must stay emoji-free inside chat");

// 5. SalemChatPanel loads preload metadata for the persona subtitle, but the
//    Docs/Tools/Skills/Context count pills were removed on purpose
//    (2026-06-11, Val: "no one cares about the docs count") — they must
//    not come back.
assert.match(widget, /preload/, "widget must load Salem preload metadata");
assert.doesNotMatch(widget, /salem-panel__preload/, "preload count pills stay removed from the Salem header");

// 6. Workspace exposes Salem via the shared companion tab opener, which expands
//    the right panel. The right edge-rail toggle was retired in favour of the
//    shell's floating top-right panel toggle.
const workspace = await readFile(path.join(root, "src/components/workspace.tsx"), "utf8");
// The right companion rail was removed; Salem was re-homed into the
// drag-to-split pane. Its launcher event now opens Salem in the split.
assert.match(workspace, /cave:salem-open/, "workspace must listen for Salem launcher events");
assert.match(workspace, /setSplitTarget\(\{ kind: "salem" \}\)/, "Salem launcher must open Salem in the drag-to-split pane");
assert.match(workspace, /import \{ SalemChatPanel \}/, "workspace should import only the Salem sidepanel surface");
assert.doesNotMatch(workspace, /SalemWidget|salemRetreating/, "workspace must not render or compute floating Salem state");
assert.match(workspace, /<SalemChatPanel\s+familiarId=\{/, "workspace must render Salem in the split with the local familiar id");
assert.match(workspace, /<SalemChatPanel[\s\S]*?model=\{/, "workspace must render Salem in the split with the local familiar's model");

// 7. CSS classes present
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
assert.doesNotMatch(css, /\.salem-perch|--salem-proximity/, "floating Salem perch CSS should stay removed");
assert.match(css, /\.salem-panel/, "must have .salem-panel CSS");
assert.match(css, /\.salem-panel--rail/, "must support Salem inside the right rail");
assert.match(css, /\.salem-msg/, "must have .salem-msg CSS");
assert.doesNotMatch(css, /\.salem-panel__preload/, "preload pill CSS removed with the pills — no dead rules");
assert.match(css, /--background:\s*oklch\([^)]+\);/, "default dark app background must be lifted for black-cat contrast");
assert.doesNotMatch(css, /\.salem-msg__glyph/, "open Salem chat must not keep unused emoji glyph CSS");

console.log("✅  Salem guard tests passed");
