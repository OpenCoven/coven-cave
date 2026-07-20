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
  assert.match(src, />\s*New folder\s*</, "shows a visible New folder action");
  assert.match(src, /Select this folder/, "can select the current folder");
  assert.match(src, /import \{ PROJECT_ROOT_WORKSPACE_HELP \} from "@\/lib\/project-root-guidance"/, "imports the shared workspace guidance copy");
  assert.match(src, /\{PROJECT_ROOT_WORKSPACE_HELP\}/, "renders the shared workspace guidance in the modal footer");
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

test("the modal keeps a stable panel and creates folders inline", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(
    src,
    /className="flex h-\[560px\] w-\[520px\] max-h-\[calc\(100dvh-2rem\)\] max-w-\[calc\(100vw-2rem\)\] flex-col overflow-hidden/,
    "the panel keeps a stable 520x560 size with viewport caps",
  );
  assert.match(src, /fetch\("\/api\/fs-browse", \{\s*method: "POST"/, "new folders post to the browse route");
  assert.match(
    src,
    /body: JSON\.stringify\(\{ dir: cwd, name: newFolderName \}\)/,
    "folder creation posts the current directory and draft name",
  );
  assert.match(src, /await load\(body\.path, sessionGeneration\)/, "successful creation enters the returned folder");
  assert.match(src, /role="alert"/, "inline creation errors announce via role=alert");
});

test("the modal keeps inline folder creation hooks, session guards, and focus targets stable", () => {
  const src = read("./directory-picker-modal.tsx");
  const earlyReturn = src.indexOf("if (!open) return null;");
  assert.ok(earlyReturn > 0, "the closed-modal early return exists");
  assert.doesNotMatch(
    src.slice(earlyReturn),
    /use(?:State|Effect|Callback|Memo|Ref)\(/,
    "no hooks appear after the closed-modal early return",
  );
  assert.match(src, /const modalSessionRef = useRef\(0\);/, "tracks a modal session generation");
  assert.match(src, /const loadGenerationRef = useRef\(0\);/, "tracks per-load ordering within a modal session");
  assert.match(
    src,
    /modalSessionRef\.current \+= 1;[\s\S]*if \(open\) void load\(null, sessionGeneration\);/,
    "opening or closing the modal bumps the session generation before loading",
  );
  assert.match(
    src,
    /const loadGeneration = \+\+loadGenerationRef\.current;[\s\S]*if \(sessionGeneration !== modalSessionRef\.current \|\| loadGeneration !== loadGenerationRef\.current\) return;[\s\S]*finally \{\s*if \(sessionGeneration !== modalSessionRef\.current \|\| loadGeneration !== loadGenerationRef\.current\) return;\s*setLoading\(false\);/,
    "load ignores stale same-session responses and stale finally writes",
  );
  assert.match(
    src,
    /else \{\s*loadGenerationRef\.current \+= 1;[\s\S]*setHome\(null\);[\s\S]*setLoading\(false\);/,
    "closing the modal invalidates pending loads before resetting state",
  );
  assert.match(
    src,
    /const sessionGeneration = modalSessionRef\.current;[\s\S]*if \(sessionGeneration !== modalSessionRef\.current\) return;[\s\S]*await load\(body\.path, sessionGeneration\);[\s\S]*finally \{\s*if \(sessionGeneration !== modalSessionRef\.current\) return;\s*setCreateBusy\(false\);/,
    "folder creation ignores stale completion and finally writes from prior modal sessions",
  );
  assert.match(src, /const newFolderTriggerRef = useRef<HTMLButtonElement \| null>\(null\);/, "keeps a stable ref for the New folder trigger");
  assert.match(src, /ref=\{newFolderTriggerRef\}/, "wires the trigger ref to the New folder button");
  assert.match(src, /const closeButtonRef = useRef<HTMLButtonElement \| null>\(null\);/, "keeps a stable ref for the header Close button");
  assert.match(src, /ref=\{closeButtonRef\}/, "wires the stable ref to the header Close button");
  assert.match(
    src,
    /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*setCreateBusy\(true\);/,
    "submit moves focus to the stable Close button before busy disables inline controls",
  );
  assert.match(
    src,
    /requestAnimationFrame\(\(\) => newFolderTriggerRef\.current\?\.focus\(\{ preventScroll: true \}\)\);/,
    "cancel returns focus to the New folder trigger",
  );
  assert.match(
    src,
    /if \(shouldRefocusInput\) \{\s*requestAnimationFrame\(\(\) => newFolderInputRef\.current\?\.focus\(\{ preventScroll: true \}\)\);/,
    "current-request errors refocus the folder-name input",
  );
  assert.match(
    src,
    /await load\(body\.path, sessionGeneration\);\s*if \(sessionGeneration === modalSessionRef\.current\) shouldRefocusCloseButton = true;/,
    "successful creation refocuses the stable Close button after navigation",
  );
  assert.match(
    src,
    /if \(shouldRefocusCloseButton\) \{\s*requestAnimationFrame\(\(\) => closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)\);/,
    "post-navigation focus lands on the stable Close button",
  );
  assert.doesNotMatch(
    src,
    /newFolderTriggerRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*setCreateBusy\(true\);/,
    "the disabled New folder trigger is not used as the submit focus target",
  );
  assert.doesNotMatch(
    src,
    /shouldRefocusTrigger = true/,
    "success focus no longer targets the New folder trigger",
  );
  assert.doesNotMatch(
    src,
    /dialogRef\.current\?\.focus\(/,
    "the flow no longer focuses the dialog panel directly",
  );
  assert.match(
    src,
    /if \(event\.key === "Escape"\) \{[\s\S]*cancelCreatingFolder\(\);[\s\S]*return;/,
    "Escape still cancels inline creation without closing the modal",
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
