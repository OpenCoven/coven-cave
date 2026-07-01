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
});
