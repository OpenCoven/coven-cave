// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../..");

// 1. SalemCat3D exists and uses Three.js
const cat3d = await readFile(path.join(root, "src/components/salem/salem-cat-3d.tsx"), "utf8");
assert.match(cat3d, /from "three"/, "salem-cat-3d must import Three.js");
assert.match(cat3d, /SalemCat3D/, "must export SalemCat3D");
assert.match(cat3d, /SphereGeometry/, "must build a sphere (head/body)");
assert.match(cat3d, /ConeGeometry/, "must build cones (ears)");
assert.match(cat3d, /TubeGeometry/, "must build a tube (tail)");
assert.match(cat3d, /idle.*happy.*thinking.*listening/s, "must handle all four moods");
assert.match(cat3d, /color:\s*0x171520/, "black cat material must retain visible contrast on dark Cave chrome");
assert.match(cat3d, /rimLight.*1\.15/s, "cat must keep a visible purple rim light");

// 2. SalemWidget launches the right panel; SalemChatPanel wires chat + API
const widget = await readFile(path.join(root, "src/components/salem/salem-widget.tsx"), "utf8");
assert.match(widget, /SalemCat3D/, "widget must embed SalemCat3D");
assert.match(widget, /SalemChatPanel/, "must export SalemChatPanel for the right rail");
assert.match(widget, /type SalemWidgetProps = \{[\s\S]*retreat\?: boolean[\s\S]*\}/, "floating Salem must accept a screen-driven retreat prop");
assert.match(widget, /cave:salem-open/, "launcher must request the shell right panel");
assert.match(widget, /\/api\/salem/, "widget must call /api/salem");
assert.match(widget, /salem-panel--rail/, "chat must render in the shell right panel");
assert.match(widget, /size=\{88\}/, "perch cat must be large enough to read on dark backgrounds");
assert.match(widget, /clientX >= window\.innerWidth - 2/, "floating Salem must retreat when the pointer leaves through the right edge");
assert.match(widget, /clientX < window\.innerWidth - 96/, "floating Salem must return when the pointer moves back from the right edge");
assert.match(widget, /salem-perch--retreating/, "floating Salem must expose a retreating class");
assert.match(
  widget,
  /salem-perch__label[\s\S]*?<Icon name="ph:chat-circle-dots-fill"/,
  "the perch label is an icon (chat-with-Salem), not a text label",
);
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
assert.match(route, /familiar|familiar/, "must know about familiars");
assert.match(route, /role|Role/, "must know about roles");
assert.match(route, /plugin|Plugin/, "must know about plugins");
assert.match(route, /Male black cat/, "must answer with Salem's persona");
assert.doesNotMatch(route, /🐱|😅/, "Salem API replies must stay emoji-free inside chat");

// 5. SalemWidget loads preload metadata for the persona subtitle, but the
//    Docs/Tools/Skills/Context count pills were removed on purpose
//    (2026-06-11, Val: "no one cares about the docs count") — they must
//    not come back.
assert.match(widget, /preload/, "widget must load Salem preload metadata");
assert.doesNotMatch(widget, /salem-panel__preload/, "preload count pills stay removed from the Salem header");

// 6. Workspace exposes Salem via the shared companion tab opener, which expands
//    the right panel. The right edge-rail toggle was retired in favour of the
//    shell's floating top-right panel toggle.
const workspace = await readFile(path.join(root, "src/components/workspace.tsx"), "utf8");
const companionRail = await readFile(path.join(root, "src/components/companion-rail.tsx"), "utf8");
assert.match(workspace, /const openCompanionTab = useCallback/, "Salem opens through the shared companion tab opener");
assert.match(workspace, /shellRef\.current\?\.openFamiliar\(\)/, "the companion tab opener expands the right panel");
assert.match(workspace, /cave:salem-open/, "workspace must listen for Salem launcher events");
assert.match(workspace, /shellRef\.current\?\.openFamiliar\(\)/, "Salem launcher must expand the right panel");
assert.match(workspace, /setRailTab\("salem"\)/, "Salem launcher must select the Salem rail tab");
assert.match(workspace, /import \{ SalemChatPanel, SalemWidget \}/, "workspace must import both Salem surfaces");
assert.match(workspace, /const salemRetreating =[\s\S]*?mode === "chat"[\s\S]*?mode === "workflows"[\s\S]*?mode === "browser"[\s\S]*?mode === "terminal"/, "workspace must retreat floating Salem on crowded surfaces");
assert.match(workspace, /const salemRetreating =\s*\n?\s*familiarPanelOpen \|\|/, "floating Salem must always retreat while the right side panel is open");
assert.match(workspace, /<SalemWidget retreat=\{salemRetreating\} \/>/, "workspace must render floating Salem with screen-driven retreat state");
assert.match(workspace, /salemSlot=\{<SalemChatPanel \/>\}/, "workspace must render Salem in the companion rail");
assert.match(companionRail, /"salem"/, "companion rail must expose a Salem tab");

// 7. CSS classes present
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.salem-perch/, "must have .salem-perch CSS");
assert.match(css, /\.salem-panel/, "must have .salem-panel CSS");
assert.match(css, /\.salem-panel--rail/, "must support Salem inside the right rail");
assert.match(css, /\.salem-msg/, "must have .salem-msg CSS");
assert.doesNotMatch(css, /\.salem-panel__preload/, "preload pill CSS removed with the pills — no dead rules");
assert.match(css, /--background:\s*oklch\([^)]+\);/, "default dark app background must be lifted for black-cat contrast");
assert.match(css, /\.salem-perch::before/, "Salem perch must include a visibility halo");
assert.match(css, /\.salem-perch--retreating/, "Salem perch must have an offscreen retreat state");
assert.match(css, /translate3d\(calc\(100% \+ 36px\), 10px, 0\)/, "Salem retreat should slide fully off the right edge");
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.salem-perch--retreating/, "Salem retreat must respect reduced motion");
assert.doesNotMatch(css, /\.salem-msg__glyph/, "open Salem chat must not keep unused emoji glyph CSS");
assert.match(css, /position:\s*fixed/, "salem perch must be position fixed");

console.log("✅  Salem guard tests passed");
