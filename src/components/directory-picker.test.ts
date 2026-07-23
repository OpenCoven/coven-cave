import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Adding a project offers a "Browse…" folder picker: native OS dialog on
// desktop, an in-app $HOME browser on the web build. The flow lives in the
// shared add-project hook (chat composer picker + first-project gate).

test("the add-project flow wires a folder picker that goes native vs web per platform", () => {
  const src = read("./project-picker.tsx");
  assert.match(src, /import \{ DirectoryPickerModal \}/, "imports the web folder browser");
  assert.match(src, /import \{ isTauri \} from "@\/lib\/tauri-platform"/, "imports the platform check");
  // Desktop → native OS dialog; web → in-app browser.
  assert.match(src, /if \(isTauri\(\)\)[\s\S]*invoke<string \| null>\("shell_pick_directory"\)/, "desktop uses the native picker");
  assert.match(src, /setPickerOpen\(true\)/, "web falls back to the in-app browser");
  assert.match(src, /<DirectoryPickerModal[\s\S]*onSelect=\{\(dir\) =>/, "mounts the modal");
});

test("the fs-browse route is loopback-gated and walks from trusted volume roots", () => {
  const src = read("../app/api/fs-browse/route.ts");
  assert.match(src, /rejectNonLocalRequest\(req\)/, "loopback-only");
  assert.match(src, /resolveBrowsableDir\(requested\)/, "resolves via the trusted volume-root walk");
  assert.match(src, /path not allowed[\s\S]*status: 403/, "rejects escapes with 403");
  assert.match(src, /homeRoot\(\)/, "still reports $HOME as the picker's entry point");
  assert.match(src, /DRIVES_LOCATION/, "exposes the drives pseudo-location for volume switching");
  assert.match(
    src,
    /listSystemRoots\(\)\.length > 1\s*\?\s*DRIVES_LOCATION\s*:\s*null/,
    "volume roots only climb to the drives list when there is more than one volume",
  );
  assert.match(
    src,
    /listSystemRootEntries\(\)\.map\(\(entry\) => \(\{ \.\.\.entry, workspace: false \}\)\)/,
    "drive entries never claim the workspace badge",
  );
});

test("the modal navigates via the fs-browse API with up/select controls", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /\/api\/fs-browse\?dir=\$\{encodeURIComponent\(dir\)\}/, "fetches the browse API");
  assert.match(src, /aria-label="Up one folder"/, "has an up-a-level control");
  assert.match(src, />\s*New folder\s*</, "shows a visible New folder action");
  assert.match(src, /const selectLabel = pendingName \? `Select \$\{truncateName\(pendingName\)\}` : atDrivesList \? "Open a drive" : "Select home";/, "the primary action names the folder it will select");
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
    /className="flex w-\[560px\] max-w-full max-h-\[min\(680px,92dvh\)\] flex-col overflow-hidden/,
    "the panel keeps the 560px redesign width with viewport caps",
  );
  assert.match(src, /fetch\("\/api\/fs-browse", \{\s*method: "POST"/, "new folders post to the browse route");
  assert.match(
    src,
    /body: JSON\.stringify\(\{ dir: cwd, name: newFolderName \}\)/,
    "folder creation posts the current directory and draft name",
  );
  assert.match(src, /await load\(cwd, sessionGeneration\);/, "successful creation reloads the current folder (not the new one)");
  assert.match(src, /setSelectedPath\(body\.path\);/, "successful creation highlights the new folder for one-click select");
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
    /const sessionGeneration = modalSessionRef\.current;[\s\S]*if \(sessionGeneration !== modalSessionRef\.current\) return;[\s\S]*await load\(cwd, sessionGeneration\);[\s\S]*finally \{\s*if \(sessionGeneration !== modalSessionRef\.current\) return;\s*setCreateBusy\(false\);/,
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
    /await load\(cwd, sessionGeneration\);\s*if \(sessionGeneration === modalSessionRef\.current\) \{\s*setSelectedPath\(body\.path\);\s*shouldRefocusCloseButton = true;/,
    "successful creation refocuses the stable Close button after the reload",
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

// cave-tv71: project-folder-modal redesign (Claude Design handoff). Clicking a
// row highlights it without entering; the chevron (or double-click) opens it;
// the footer echoes the pending path and names the folder the primary action
// will select. $HOME itself stays unselectable, matching the server-side
// isAllowedNewProjectRoot boundary.
test("the redesigned modal separates selection from navigation", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(
    src,
    /onClick=\{\(\) =>\s*atDrivesList\s*\?\s*navigateTo\(entry\.path\)\s*:\s*setSelectedPath\(\(prev\) => \(prev === entry\.path \? null : entry\.path\)\)\s*\}/,
    "clicking a row toggles the highlight instead of entering the folder (drives enter directly)",
  );
  assert.match(src, /onDoubleClick=\{\(\) => navigateTo\(entry\.path\)\}/, "double-click opens the folder");
  assert.match(src, /aria-label=\{`Open \$\{entry\.name\}`\}/, "each row keeps an explicit chevron open control");
  assert.match(src, /aria-pressed=\{isSelected\}/, "row selection is exposed to assistive tech");
  assert.match(
    src,
    /const pendingPath = selected\?\.path \?\? \(atDrivesList \? null : cwd\);/,
    "the footer resolves the highlighted folder before the browsed one",
  );
  assert.match(
    src,
    /const selectDisabled =\s*\n?\s*!cwd \|\| createBusy \|\| !pendingPath \|\| pendingPath === home \|\| isVolumeRootPath\(pendingPath\);/,
    "bare $HOME and bare volume roots cannot be selected",
  );
  assert.match(src, />Selecting</, "the footer labels the pending selection");
  assert.match(src, /\{pendingPath \? collapseHome\(pendingPath\) : "…"\}/, "the footer echoes the ~-collapsed pending path");
});

test("the redesigned modal keeps breadcrumbs, filtering, and per-folder state resets", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /aria-label="Folder path"/, "the toolbar exposes a breadcrumb nav");
  assert.match(src, /aria-current=\{isLast \? "location" : undefined\}/, "the current crumb is marked for assistive tech");
  assert.match(src, /onClick=\{\(\) => navigateTo\(crumb\.path\)\}/, "crumbs jump straight to any ancestor");
  assert.match(src, /aria-label="Filter folders"/, "the filter input is labelled");
  assert.match(
    src,
    /const visibleEntries = query \? entries\.filter\(\(e\) => e\.name\.toLowerCase\(\)\.includes\(query\)\) : entries;/,
    "filtering is client-side over the loaded entries",
  );
  assert.match(
    src,
    /No folders match \\u201C\$\{filter\.trim\(\)\}\\u201D/,
    "the empty state names the failing filter query",
  );
  assert.match(
    src,
    /const navigateTo = useCallback\(\s*\(dir: string \| null\) => \{\s*setFilter\(""\);\s*setSelectedPath\(null\);\s*resetCreateFolderState\(\);/,
    "navigation clears filter, highlight, and inline create before loading",
  );
});

test("the redesigned modal badges workspace folders and keeps the design-language chrome", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /title="Inside a Cave workspace"/, "workspace rows explain the badge on hover");
  assert.match(src, /entry\.workspace \? "text-\[var\(--accent-presence\)\]" : "text-\[var\(--text-muted\)\]"/, "workspace folder icons pick up the accent");
  assert.match(src, /Pick where this project(&apos;|')s chats will live\./, "the header keeps the redesign subtitle");
  assert.match(src, /color-mix\(in_oklch,var\(--bg-panel\)_62%,transparent\)/, "the scrim uses the translucent panel mix, not bg-black");
  assert.doesNotMatch(src, /bg-black\/50/, "the old opaque scrim is gone");
  assert.match(src, /backdrop-blur-\[6px\]/, "the scrim blurs the page behind the modal");
  assert.match(src, /\[animation:ui-modal-enter_var\(--duration-base\)_var\(--ease-decelerate\)\]/, "the card reuses the shared pop-in keyframes");
  const motionReduceCount = src.split("motion-reduce:[animation:none]").length - 1;
  assert.ok(motionReduceCount >= 2, "scrim and card both honor prefers-reduced-motion");
  assert.doesNotMatch(src, /rgba\(255,\s*255,\s*255/, "no hard-coded white overlays");
});

test("fs-browse marks entries inside configured workspaces for the picker badge", () => {
  const src = read("../app/api/fs-browse/route.ts");
  assert.match(
    src,
    /import \{ resolveAllowedProjectSubpath \} from "@\/lib\/server\/project-paths"/,
    "the route reuses the allowed-project-roots resolver",
  );
  assert.match(
    src,
    /workspace: resolveAllowedProjectSubpath\(entry\.path\) !== null,/,
    "each listed entry carries a workspace flag",
  );
});

// cave-zf1f: the picker was capped at $HOME, so projects on another drive (or
// anywhere above home) could never be selected on the web build. Browsing now
// walks up to volume roots and across drives via the ::drives pseudo-location,
// while bare roots stay unselectable like $HOME itself.
test("the modal browses above $HOME to volume roots and drives", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /const DRIVES = "::drives";/, "shares the drives pseudo-location with the API");
  assert.match(
    src,
    /if \(cwd === DRIVES\) return \[\{ name: "Drives", path: DRIVES \}\];/,
    "the drives list gets a single Drives crumb",
  );
  assert.match(
    src,
    /cwd === home \|\| cwd\.startsWith\(home \+ sep\)/,
    "home-anchored crumbs are separator-aware (Windows web builds get real crumbs)",
  );
  assert.match(
    src,
    /trail\.push\(\{ name: acc, path: acc \}\);/,
    "paths above $HOME anchor their crumbs at the volume root",
  );
  assert.match(
    src,
    /\/\^\[A-Za-z\]:\[\\\\\/\]\$\/\.test\(value\)/,
    "volume roots are recognized on both platforms",
  );
  assert.match(
    src,
    /name=\{atDrivesList \? "ph:hard-drives" : "ph:folder"\}/,
    "drive rows render the hard-drives glyph",
  );
  assert.match(
    src,
    /disabled=\{loading \|\| createBusy \|\| !cwd \|\| creatingFolder \|\| cwd === DRIVES\}/,
    "New folder is unavailable on the drives list",
  );
});
