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
  assert.match(src, /params\.set\("dir", dir\)/, "fetches the browse API for the requested folder");
  assert.match(src, /`\/api\/fs-browse\?\$\{query\}`/, "builds the browse URL from encoded params");
  assert.match(src, /LOCAL_REQUEST_REQUIRED_CODE/, "reads the stable local-only error code from fs-browse");
  assert.match(src, /LOCAL_PROJECT_CREATION_MESSAGE/, "maps local-only browse failures to project-registration guidance");
  assert.match(src, /body\.code === LOCAL_REQUEST_REQUIRED_CODE/, "uses the machine-readable code instead of matching forbidden text");
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
    /className="flex w-\[760px\] max-w-full max-h-\[min\(680px,92dvh\)\] flex-col overflow-hidden/,
    "the panel keeps its viewport caps at the width the places rail needs",
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
    // The restore of the session-scoped "show hidden" preference sits between
    // the branch and the load, because `load` reads that ref synchronously —
    // hence [\s\S]*? rather than \s* here. The generation bump still has to
    // come first, which is what this actually guards.
    /modalSessionRef\.current \+= 1;[\s\S]*if \(open\) \{[\s\S]*?void load\(null, sessionGeneration\);\s*void loadPlaces\(sessionGeneration\);/,
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
  assert.match(src, /aria-label="Folder breadcrumbs"/, "the toolbar exposes a breadcrumb nav");
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
    /const navigateTo = useCallback\(\s*\(dir: string \| null,[\s\S]*?\) => \{\s*setFilter\(""\);\s*setSelectedPath\(null\);\s*resetCreateFolderState\(\);/,
    "navigation clears filter, highlight, and inline create before loading",
  );
});

test("the modal accepts a pasted folder path and preserves invalid drafts", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /const \[pathDraft, setPathDraft\] = useState\(""\);/, "keeps an editable path draft");
  assert.match(src, /const \[pathError, setPathError\] = useState<string \| null>\(null\);/, "tracks direct-path failures separately");
  assert.match(
    src,
    /setPathDraft\(body\.cwd === DRIVES \? "" : body\.cwd\);/,
    "successful folder loads synchronize the address field",
  );
  assert.match(
    src,
    /const nextPath = pathDraft\.trim\(\);[\s\S]*navigateTo\(nextPath, \{ fromPathEntry: true \}\);/,
    "pasted paths navigate through the existing browse flow",
  );
  assert.match(src, /<label[\s\S]*htmlFor="directory-picker-path"[\s\S]*Folder path/, "the field has a persistent visible label");
  assert.match(src, /onSubmit=\{\(event\) => \{[\s\S]*submitPathDraft\(\);/, "Enter submits the path field");
  assert.match(src, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/, "focus selects the current path for replacement");
  assert.match(src, /aria-invalid=\{Boolean\(pathError\)\}/, "invalid pasted paths expose their state");
  assert.match(src, /if \(fromPathEntry\) setPathError\(message\);/, "browse failures stay attached to direct path entry");
  assert.match(src, /\{error && !pathError \? \(/, "direct path errors do not replace the current folder listing");
  assert.match(src, /setPathDraft\(""\);[\s\S]*setPathError\(null\);/, "closing the modal clears path-local state");
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

// The web build has no native dialog, so every folder outside $HOME used to
// cost one click per level. The modal now carries Explorer's two sidebar rails
// — Quick access (home + known folders + user pins) and This PC (labeled
// volumes) — as one-click jump-off points.
test("the modal renders a places rail fed by the fs-browse places endpoint", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /fetch\("\/api\/fs-browse\?places=1", \{ cache: "no-store" \}\)/, "fetches the sidebar places");
  assert.match(src, /aria-label="Places"/, "the rail is a labelled landmark");
  assert.match(
    src,
    /if \(res\.ok && body\.ok && body\.groups\) setPlaceGroups\(body\.groups\);/,
    "only a well-formed places response populates the rail",
  );
  assert.match(
    src,
    /catch \{\s*\/\* offline or loopback-gated — the rail simply stays empty \*\/\s*\}/,
    "a failed places fetch degrades to an empty rail instead of an error state",
  );
  assert.match(src, /onClick=\{\(\) => navigateTo\(place\.path\)\}/, "rail rows navigate to the place");
  assert.match(
    src,
    /aria-current=\{isCurrent \? "location" : undefined\}/,
    "the rail marks the folder currently being browsed",
  );
  assert.match(src, /setPlaceGroups\(\[\]\);/, "closing the modal drops the rail with the rest of the state");
});

test("the modal pins folders into Quick access and keeps pins client-owned", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(
    src,
    /import \{\s*isPinned,\s*readPins,\s*togglePin,\s*writePins,/,
    "pin state comes from the shared pins helper, not an inline localStorage read",
  );
  assert.match(src, /setPins\(readPins\(\)\);/, "opening the modal reloads the stored pins");
  assert.match(
    src,
    /const next = togglePin\(pins, \{ name: entry\.name, path: entry\.path \}\);\s*setPins\(next\);\s*writePins\(next\);/,
    "toggling a pin updates state and storage together",
  );
  assert.match(
    src,
    /aria-label=\{pinned \? `Unpin \$\{entry\.name\}` : `Pin \$\{entry\.name\}`\}/,
    "the pin control names what it will do",
  );
  assert.match(src, /aria-pressed=\{pinned\}/, "pin state is exposed to assistive tech");
  assert.match(
    src,
    /group\.id === "quick" \? \{ \.\.\.group, places: \[\.\.\.group\.places, \.\.\.pinnedPlaces\] \} : group/,
    "pins ride along in Quick access, where Explorer puts them",
  );
  assert.match(src, /\{atDrivesList \? null : \(/, "the drives list has no pinnable rows");
});

test("fs-browse serves the sidebar places behind the same loopback gate", () => {
  const src = read("../app/api/fs-browse/route.ts");
  assert.match(
    src,
    /if \(req\.nextUrl\.searchParams\.get\("places"\) === "1"\) \{\s*return NextResponse\.json\(\{ ok: true, home: homeRoot\(\), groups: listPlaceGroups\(\) \}\);/,
    "?places=1 returns the sidebar groups",
  );
  const gate = src.indexOf("rejectNonLocalRequest(req)");
  const places = src.indexOf('searchParams.get("places")');
  assert.ok(gate > 0 && places > gate, "the places branch sits behind the loopback gate");
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
    /function serverSep\(home: string \| null\)/,
    "the separator is derived once from the trusted server-reported $HOME",
  );
  assert.doesNotMatch(
    src,
    /includes\("\\\\"\) \? "\\\\" : "\/"/,
    "never sniff per-path for backslashes — POSIX folder names may legally contain them",
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

// ── Hidden (dot-prefixed) folders ───────────────────────────────────────────
// Dot folders used to be listed unconditionally, which buried an ordinary
// project pick under .git/.cache/.local noise. They are hidden by default now
// and revealed on demand; the two halves that must not drift are that the
// server owns the default, and that hiding is presentation rather than a
// second access rule layered on top of the trusted walk.

test("fs-browse hides dot folders by default and reveals them only on request", () => {
  const src = read("../app/api/fs-browse/route.ts");
  assert.match(
    src,
    /const includeHidden = req\.nextUrl\.searchParams\.get\("hidden"\) === "1"/,
    "the reveal is an explicit opt-in query flag",
  );
  assert.match(
    src,
    /listSubdirs\(dir, \{ includeHidden \}\)/,
    "the listing helper owns the hiding default — the route must not re-filter",
  );
  assert.match(src, /hiddenCount: listing\.hiddenCount/, "reports how many folders are hidden");
  assert.match(src, /hiddenCount: 0/, "the drives location reports a stable shape too");
  // Hiding must not narrow what resolveBrowsableDir will admit: a pinned or
  // crumbed .config has to keep resolving whatever the toggle says.
  assert.doesNotMatch(
    src,
    /resolveBrowsableDir\([^)]*includeHidden/,
    "the trusted walk never takes the hidden flag",
  );
});

test("listSubdirs is the single place the hiding default lives", () => {
  const src = read("../lib/server/home-browse.ts");
  assert.match(src, /export function isHiddenDirName/, "exports the dot-prefix rule");
  assert.match(src, /return name\.startsWith\("\."\)/, "hidden means dot-prefixed, cross-platform");
  assert.match(
    src,
    /\{ includeHidden = false \}: \{ includeHidden\?: boolean \} = \{\}/,
    "hiding is the default and revealing is opt-in",
  );
  assert.match(
    src,
    /includeHidden \? all : all\.filter\(\(entry\) => !entry\.hidden\)/,
    "hidden entries are dropped from the listing, not from the count",
  );
  // SKIP is the separate, unconditional build-noise list. Revealing dot
  // folders must not smuggle node_modules back into the picker.
  assert.match(
    src,
    /\.filter\(\(d\) => d\.isDirectory\(\) && !SKIP\.has\(d\.name\)\)/,
    "build-noise filtering stays unconditional",
  );
});

test("the picker offers an accessible, session-scoped reveal toggle", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /if \(showHiddenRef\.current\) params\.set\("hidden", "1"\)/, "asks the server to reveal");
  assert.match(src, /aria-pressed=\{showHidden\}/, "the control reports its pressed state");
  assert.match(
    src,
    /aria-label=\{\s*hiddenCount > 0 \? `Show hidden folders \(\$\{hiddenCount\}\)` : "Show hidden folders"\s*\}/,
    "the accessible name keeps a constant verb so the pressed state is unambiguous",
  );
  assert.doesNotMatch(
    src,
    /aria-label=\{showHidden \? "Hide/,
    "the label must not flip to Hide — aria-pressed already carries the state",
  );
  assert.match(src, /window\.sessionStorage\.getItem\(SHOW_HIDDEN_KEY\)/, "session-scoped, not persistent");
  assert.doesNotMatch(src, /localStorage\.setItem\(SHOW_HIDDEN_KEY/, "the reveal must not outlive the session");
  assert.match(src, /leadingIcon=\{showHidden \? "ph:eye" : "ph:eye-slash"\}/, "the glyph tracks the state");
  assert.doesNotMatch(src, /<button\b/, "the toggle uses the shared Button primitive");
});

test("toggling reveal reloads the current folder and drops a stale highlight", () => {
  const src = read("./directory-picker-modal.tsx");
  assert.match(src, /const toggleShowHidden = useCallback\(/, "toggling is a callback, not inline state juggling");
  // Scoped to the toggle body on purpose: a bare `setSelectedPath(null);`
  // occurs four times in this file (navigate, filter, close), so an unscoped
  // match would pass with the toggle's own call deleted. Re-hiding while a dot
  // folder is highlighted has to drop that highlight.
  assert.match(
    src,
    /const toggleShowHidden = useCallback\(\(\) => \{[\s\S]*?setSelectedPath\(null\);[\s\S]*?void load\(cwd\);/,
    "the toggle itself clears the highlight before reloading",
  );
  assert.match(src, /void load\(cwd\);/, "reloads the folder in place rather than returning to $HOME");
  assert.match(src, /writeShowHidden\(next\)/, "the new state is persisted for the session");
  // load() must stay dependency-free of the toggle: a new load identity
  // re-runs the open effect and bounces the user back to $HOME.
  assert.match(src, /const showHiddenRef = useRef\(false\)/, "the flag reaches load through a ref");
  assert.match(src, /\}, \[cwd, load\]\)/, "the toggle depends on the folder it reloads");
});

test("creating a dot folder reveals it instead of hiding what the user just made", () => {
  const src = read("./directory-picker-modal.tsx");
  // The footer resolves its pending selection out of the *visible* entries, so
  // a new folder that vanishes into the hidden set does not merely disappear —
  // "Select .config" silently becomes "Select <parent>" and the wrong root gets
  // registered. Creating it by name is an explicit request to see it.
  assert.match(
    src,
    /requestedName\.startsWith\("\."\) && !showHiddenRef\.current[\s\S]*?showHiddenRef\.current = true/,
    "a freshly created dot folder flips the reveal on",
  );
  assert.match(
    src,
    /showHiddenRef\.current = true;\s*setShowHidden\(true\);\s*writeShowHidden\(true\);\s*\}\s*await load\(cwd, sessionGeneration\)/,
    "the reveal is set before the reload that has to return the new folder",
  );
});

test("the picker never reports a folder as empty while it is withholding dot folders", () => {
  const src = read("./directory-picker-modal.tsx");
  // "This folder is empty" beside a toggle reading "Hidden folders (3)" is a
  // flat contradiction, and a filter typed as ".config" would otherwise report
  // no match for a folder that is really there.
  assert.match(src, /const withheldHidden = showHidden \? 0 : hiddenCount;/, "the empty state knows what is withheld");
  assert.match(
    src,
    /withheldHidden > 0\s*\? "Only hidden folders here"\s*: "This folder is empty"/,
    "an all-dot folder is not described as empty",
  );
  assert.match(
    src,
    /\$\{withheldHidden\} hidden folder\$\{withheldHidden === 1 \? " is" : "s are"\} not shown\./,
    "the sub-line says how many are withheld, under the no-match copy too",
  );
});
