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

test("the gate browses with native shell fallback and seeds the drafts from the chosen path", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ DirectoryPickerModal \} from "@\/components\/directory-picker-modal"/, "imports the shared web directory picker");
  assert.match(src, /import \{ isTauri \} from "@\/lib\/tauri-platform"/, "checks the current platform");
  assert.match(src, /invoke<string \| null>\("shell_pick_directory"\)/, "uses the native folder chooser in Tauri");
  assert.match(src, /catch \{[\s\S]*setPickerOpen\(true\);/, "falls back to the web directory picker if the native dialog fails");
  assert.match(src, /<DirectoryPickerModal[\s\S]*onSelect=\{\(dir\) => \{[\s\S]*setPickerOpen\(false\);[\s\S]*applyPickedRoot\(dir\);/, "web selection closes the picker and applies the chosen path");
  assert.match(src, /setNameDraft\(\(current\) => \(current\.trim\(\) \? current : pathBasename\(trimmed\)\)\);/, "picking a folder seeds the name only when the name draft is still empty");
});

test("the gate creates through addChatProject, keeps sticky retry state, and surfaces retryable alerts", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ addChatProject \} from "@\/lib\/chat-add-project"/, "uses the shared register+grant helper");
  assert.match(src, /const \[registeredProjectId, setRegisteredProjectId\] = useState<string \| null>\(null\);/, "tracks the registered project id for partial failures");
  assert.match(src, /if \(project\) setRegisteredProjectId\(project\.id\);/, "captures the newly registered id before the grant can fail");
  assert.match(src, /existingProjectId: registeredProjectId/, "retries grant against the already-created project instead of creating a duplicate");
  assert.match(src, /name: nameDraft/, "passes the drafted name through addChatProject");
  assert.match(src, /if \(result\.ok\) \{[\s\S]*setRegisteredProjectId\(null\);/, "clears sticky visibility only after a full success");
  assert.match(src, /const \{ announce \} = useAnnouncer\(\)/, "announces success through the shared live region");
  assert.match(src, /announce\(/, "speaks the success message");
  assert.match(src, /role="alert"/, "errors announce via alerts");
  assert.match(src, /onClick=\{reloadProjects\}/, "project-list failures expose a Retry action");
  assert.match(src, /disabled=\{submitting \|\| loadingProjects \|\| Boolean\(projectsError\) \|\| !canSubmit\}/, "creation stays blocked while the registry is still loading or errored");
});

test("the gate uses the shared Button primitive and autofocuses the name field", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ Button \} from "@\/components\/ui\/button"/, "uses the shared Button primitive");
  assert.doesNotMatch(src, /<button\b/, "does not hand-roll raw button controls");
  assert.match(src, /<input[\s\S]*autoFocus[\s\S]*placeholder="Project name"/, "the project-name field takes initial focus when the gate opens");
});

console.log("first-project-gate.test.ts OK");
