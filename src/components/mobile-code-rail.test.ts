// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chat = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const task = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const sheet = await readFile(new URL("./workspace-rail-sheet.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const combined = `${chat}\n${task}\n${controller}\n${sheet}`;
const css = (
  await Promise.all(
    ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"].map((name) =>
      readFile(new URL(`../styles/${name}.css`, import.meta.url), "utf8"),
    ),
  )
).join("\n");

assert.match(controller, /const \[mobileOpen, setMobileOpen\] = useState\(false\)/);
assert.match(controller, /const mobileAvailable = active && \(isMobile \|\| paneNarrow\) && rail\.available/);
assert.match(controller, /useFocusTrap\(mobileOpen, mobileSheetRef, \{ onEscape: \(\) => setMobileOpen\(false\) \}\)/);
assert.match(controller, /!rail\.available \|\| \(!isMobile && !paneNarrow\) \|\| !active/);

for (const source of [chat, task]) {
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=\{/);
  assert.match(source, /Show code rail/);
}
assert.match(chat, /setMobileRailOpen\(\(v\) => !v\)/);
assert.match(task, /setMobileOpen\(\(open\) => !open\)/);

assert.match(sheet, /mobile-code-rail-sheet fixed inset-0 z-\[200\] flex justify-end/);
assert.match(sheet, /bg-\[var\(--backdrop-scrim\)\]/);
assert.match(sheet, /w-\[min\(92vw,420px\)\]/);
assert.match(sheet, /role="dialog"/);
assert.match(sheet, /aria-modal="true"/);
assert.match(sheet, /tabIndex=\{-1\}/);
assert.match(sheet, /hidePin/);
assert.match(sheet, /onCollapse=\{controller\.closeMobile\}/);
assert.match(sheet, /aria-label="Close code rail"[\s\S]*onClick=\{controller\.closeMobile\}/);

assert.match(rail, /hidePin\??:\s*boolean/);
assert.match(rail, /\{\s*!hidePin\s*(?:&&|\?)[\s\S]*?Pin code rail open/);
assert.match(css, /@keyframes\s+mobile-code-rail-sheet-in\b/);
assert.match(css, /\.mobile-code-rail-sheet__panel\s*\{[^}]*animation:\s*mobile-code-rail-sheet-in/s);
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.mobile-code-rail-sheet__panel[^}]*\{[^}]*animation:\s*none/s,
);
assert.match(combined, /WorkspaceRailSheet/);

console.log("mobile-code-rail.test.ts OK");
