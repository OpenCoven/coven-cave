// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chat = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const task = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const sheet = await readFile(new URL("./workspace-rail-sheet.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const combined = `${chat}\n${task}\n${controller}\n${sheet}`;

assert.match(controller, /const \[mobileOpen, setMobileOpen\] = useState\(false\)/);
assert.match(controller, /const mobileAvailable = active && \(isMobile \|\| paneNarrow\) && rail\.available/);
assert.doesNotMatch(controller, /useFocusTrap/, "the rendered Modal owns the trap");
assert.match(controller, /!rail\.available \|\| \(!isMobile && !paneNarrow\) \|\| !active/);

for (const source of [chat, task]) {
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=\{/);
  assert.match(source, /Show code rail/);
}
assert.match(chat, /setMobileRailOpen\(\(v\) => !v\)/);
assert.match(task, /setMobileOpen\(\(open\) => !open\)/);

assert.match(sheet, /<Modal open onClose=\{close\} title="Code rail" size=\{fullscreen \? "workspace" : "compact"\} presentation=\{fullscreen \? "fullscreen" : "sheet-right"\} bodyLayout="fill"/);
assert.match(sheet, /const close = \(\) => \{ setFullscreen\(false\); controller\.closeMobile\(\); \}/, "closing resets the hosted presentation and closes the controller");
assert.match(sheet, /hidePin/);
assert.match(sheet, /onCollapse=\{close\}/);


assert.match(rail, /hidePin\??:\s*boolean/);
assert.match(rail, /\{\s*!hidePin\s*(?:&&|\?)[\s\S]*?Pin code rail open/);
const sharedCss = await readFile(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");
assert.match(sharedCss, /prefers-reduced-motion: reduce/);
assert.match(combined, /WorkspaceRailSheet/);

console.log("mobile-code-rail.test.ts OK");
