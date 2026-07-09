import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// The New-project form gains a "Browse…" button: native OS folder dialog on
// desktop, an in-app $HOME browser on the web build.

test("projects-view wires a Browse button that picks native vs web per platform", () => {
  const src = read("./projects-view.tsx");
  assert.match(src, /import \{ DirectoryPickerModal \}/, "imports the web folder browser");
  assert.match(src, /import \{ isTauri \} from "@\/lib\/tauri-platform"/, "imports the platform check");
  assert.match(src, /onClick=\{\(\) => void handleBrowse\(\)\}/, "form renders a Browse button");
  // Desktop → native OS dialog; web → in-app browser.
  assert.match(src, /if \(isTauri\(\)\)[\s\S]*invoke<string \| null>\("shell_pick_directory"\)/, "desktop uses the native picker");
  assert.match(src, /setPickerOpen\(true\)/, "web falls back to the in-app browser");
  assert.match(src, /<DirectoryPickerModal[\s\S]*onSelect=\{\(dir\) =>/, "mounts the modal");
  // Picking a folder seeds the name from the folder basename when empty.
  assert.match(src, /setNameDraft\(\(current\) => \(current\.trim\(\) \? current : pathBasename\(trimmed\)\)\)/, "auto-fills name from folder");
});

test("the fs-browse route is loopback-gated and $HOME-rooted", () => {
  const src = read("../app/api/fs-browse/route.ts");
  assert.match(src, /rejectNonLocalRequest\(req\)/, "loopback-only");
  assert.match(src, /resolveWithinRoot\(root, req\.nextUrl\.searchParams\.get\("dir"\)\)/, "resolves within $HOME");
  assert.match(src, /path not allowed[\s\S]*status: 403/, "rejects escapes with 403");
  assert.match(src, /homeRoot\(\)/, "roots at $HOME");
});

test("the modal navigates via the fs-browse API with up/select controls", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /\/api\/fs-browse\?dir=\$\{encodeURIComponent\(dir\)\}/, "fetches the browse API");
  assert.match(src, /aria-label="Up one folder"/, "has an up-a-level control");
  assert.match(src, /Select this folder/, "can select the current folder");
  assert.match(src, /import \{ Button \}/, "modal actions use the shared Button primitive");
  assert.doesNotMatch(src, /<button\b/, "modal should not hand-roll button controls");
  // cave-psp8: a true modal must trap focus + restore it on close, not just listen
  // for Escape at the window (which let Tab escape to the page behind the scrim).
  assert.match(src, /useFocusTrap\(open, dialogRef, \{ onEscape: onClose \}\)/, "modal traps focus, closes on Escape, and returns focus on close");
  assert.doesNotMatch(src, /addEventListener\("keydown"/, "the hand-rolled window Escape listener is gone (useFocusTrap owns it)");
  assert.doesNotMatch(
    src,
    /rounded-md|rounded-lg|rounded(?=\s|")/,
    "modal controls should use radius tokens instead of hard-coded radii",
  );
});

// cave-lj6j: the modal mounts inside arbitrary hosts (home composer card,
// projects form). A transformed/backdrop-filtered ancestor becomes the
// containing block for position:fixed, trapping the z-[200] scrim in that
// ancestor's stacking context — composer chrome painted OVER the open modal.
// Portaling to <body> restores true-viewport fixed positioning.
test("the modal portals to <body> so host stacking contexts can't bury it", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /import \{ createPortal \} from "react-dom"/, "imports createPortal");
  assert.match(src, /return createPortal\(\s*<div\s*\n?\s*className="fixed inset-0 z-\[200\]/, "the fixed scrim renders through a portal");
  assert.match(src, /document\.body,\s*\n\s*\);/, "the portal targets document.body");
  assert.match(src, /if \(!open\) return null;[\s\S]*createPortal/, "closed modal renders nothing (portal only touches document.body when open)");
});
