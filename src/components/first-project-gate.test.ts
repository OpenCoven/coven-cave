import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the first-project gate is a sticky portaled modal with no dismiss path", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ createPortal \} from "react-dom"/, "uses a portal");
  assert.match(src, /const visible = open \|\| Boolean\(registeredProjectId\);/, "stays visible while a registered project still needs a grant retry");
  assert.match(src, /useFocusTrap\(visible, dialogRef\);/, "traps focus without an Escape dismiss handler");
  assert.doesNotMatch(src, /useFocusTrap\(visible, dialogRef, \{/, "does not wire onEscape for this mandatory gate");
  assert.match(src, /role="dialog"/, "exposes dialog semantics");
  assert.match(src, /aria-modal="true"/, "is a true modal");
  assert.match(src, /tabIndex=\{-1\}/, "dialog container is focusable for the trap fallback");
  assert.doesNotMatch(src, />\s*Close\s*</, "does not offer a close button");
  assert.doesNotMatch(src, />\s*Cancel\s*</, "does not offer a cancel button");
  assert.doesNotMatch(src, />\s*Skip\s*</, "does not offer a skip action");
  assert.match(src, /return createPortal\([\s\S]*className="fixed inset-0 z-\[200\][^"]*"/, "renders a full-screen scrim through the portal");
  assert.doesNotMatch(src, /return createPortal\([\s\S]*className="fixed inset-0 z-\[200\][\s\S]{0,220}onClick=/, "backdrop clicks do not dismiss the gate");
});

test("the gate copy makes project creation mandatory for chat", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, />\s*Create your first project\s*</, "headline names the first-project task directly");
  assert.match(src, /Chat requires a project/, "copy explains that chat cannot proceed without a project");
});

test("the gate stays prop-driven for task 3 and focuses the name field on first visibility", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(
    src,
    /type FirstProjectGateProps = \{[\s\S]*open: boolean;[\s\S]*familiarId: string \| null;[\s\S]*loadingProjects: boolean;[\s\S]*projectsError: string \| null;[\s\S]*createProject: \(name: string, root: string\) => Promise<CaveProject \| null>;\s*reloadProjects: \(\) => void;/,
    "the gate stays prop-driven with the required task-3 fields",
  );
  assert.doesNotMatch(src, /useProjects\(\)|workspace/i, "Workspace wiring stays outside this task; the gate remains a prop-driven component");
  assert.match(src, /const nameInputRef = useRef<HTMLInputElement \| null>\(null\);/, "keeps a stable ref for the project-name field");
  assert.match(
    src,
    /if \(!visible\) \{\s*wasVisibleRef\.current = false;\s*return;\s*\}\s*if \(wasVisibleRef\.current\) return;/,
    "the focus helper only runs on a false-to-true visibility transition",
  );
  assert.match(
    src,
    /window\.requestAnimationFrame\(\(\) => \{\s*nameInputRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}\);/,
    "requestAnimationFrame restores initial focus to the name field after the trap activates",
  );
  assert.match(src, /ref=\{nameInputRef\}/, "the stable focus ref is wired to the project-name input");
  assert.doesNotMatch(src, /autoFocus/, "initial focus no longer depends on DOM-order-sensitive autoFocus");
});

test("the gate browses with native shell fallback and seeds the drafts from the chosen path", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ DirectoryPickerModal \} from "@\/components\/directory-picker-modal"/, "imports the shared web directory picker");
  assert.match(src, /import \{ isTauri \} from "@\/lib\/tauri-platform"/, "checks the current platform");
  assert.match(src, /invoke<string \| null>\("shell_pick_directory"\)/, "uses the native folder chooser in Tauri");
  assert.match(src, /catch \{[\s\S]*setPickerOpen\(true\);/, "falls back to the web directory picker if the native dialog fails");
  assert.match(src, /setRootDraft\(trimmed\);/, "picking a folder assigns the chosen absolute root draft directly");
  assert.match(src, /<DirectoryPickerModal[\s\S]*onSelect=\{\(dir\) => \{[\s\S]*setPickerOpen\(false\);[\s\S]*applyPickedRoot\(dir\);/, "web selection closes the picker and applies the chosen path");
  assert.match(src, /setNameDraft\(\(current\) => \(current\.trim\(\) \? current : pathBasename\(trimmed\)\)\);/, "picking a folder seeds the name only when the name draft is still empty");
});

test("the gate keeps drafts through failures, blocks blank or busy submits, and surfaces retryable alerts", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ addChatProject \} from "@\/lib\/chat-add-project"/, "uses the shared register+grant helper");
  assert.match(src, /const \[registeredProjectId, setRegisteredProjectId\] = useState<string \| null>\(null\);/, "tracks the registered project id for partial failures");
  assert.match(src, /if \(project\) setRegisteredProjectId\(project\.id\);/, "captures the newly registered id before the grant can fail");
  assert.match(src, /existingProjectId: registeredProjectId/, "retries grant against the already-created project instead of creating a duplicate");
  assert.match(src, /name: nameDraft/, "passes the drafted name through addChatProject");
  assert.match(src, /if \(result\.ok\) \{[\s\S]*setRegisteredProjectId\(null\);/, "clears sticky visibility only after a full success");
  assert.match(src, /if \(submitting \|\| loadingProjects \|\| Boolean\(projectsError\)\) return;/, "the submit handler rejects busy or registry-blocked submits before any mutation");
  assert.match(src, /if \(!nameDraft\.trim\(\)\) \{[\s\S]*setSubmitError\("Enter a project name\."\);/, "blank project names are blocked in the submit handler");
  assert.match(src, /if \(!rootDraft\.trim\(\)\) \{[\s\S]*setSubmitError\("Enter an absolute project root\."\);/, "blank project roots are blocked in the submit handler");
  assert.doesNotMatch(src, /setNameDraft\(""\)|setRootDraft\(""\)/, "failure paths do not clear either draft");
  assert.match(src, /const \{ announce \} = useAnnouncer\(\)/, "announces success through the shared live region");
  assert.match(src, /announce\(/, "speaks the success message");
  assert.match(src, /role="alert"/, "errors announce via alerts");
  assert.match(src, /onClick=\{reloadProjects\}/, "project-list failures expose a Retry action");
  assert.match(src, /disabled=\{submitting \|\| loadingProjects \|\| Boolean\(projectsError\) \|\| !canSubmit\}/, "creation stays blocked while the registry is still loading or errored");
});

test("the gate exposes the exact root field plus Browse and Create actions through shared buttons", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ Button \} from "@\/components\/ui\/button"/, "uses the shared Button primitive");
  assert.doesNotMatch(src, /<button\b/, "does not hand-roll raw button controls");
  assert.match(src, />\s*Absolute root\s*</, "the root field keeps its exact label");
  assert.match(src, /htmlFor="first-project-gate-root"/, "the root label stays wired to the root input");
  assert.match(src, /id="first-project-gate-root"/, "the exact root input id stays stable");
  assert.match(src, /placeholder="\/absolute\/path\/to\/project"/, "the root field explains the required absolute-path format");
  assert.match(src, />\s*Browse\s*</, "the gate exposes a Browse action next to the root field");
  assert.match(src, />\s*Create\s*</, "the gate exposes a Create action for the first project");
});

console.log("first-project-gate.test.ts OK");
