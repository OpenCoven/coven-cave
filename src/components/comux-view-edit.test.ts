// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Editable file preview: the Projects preview can switch into an edit textarea
// and POST the new content back to /api/project-file.

const source = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");

// Save posts the edited content to the write endpoint.
assert.match(
  source,
  /fetch\("\/api\/project-file",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?body:\s*JSON\.stringify\(\{ path: previewPath, content: editValue \}\)/,
  "saveEdit must POST { path, content } to /api/project-file",
);

// On success the edit is committed back into the preview and edit mode exits.
assert.match(
  source,
  /setPreview\(\{ kind: "text", content: editValue[\s\S]*?\}\);[\s\S]*?setEditing\(false\)/,
  "a successful save must commit editValue into the preview and leave edit mode",
);

// Opening another file abandons an in-progress edit (no stale unsaved buffer).
assert.match(
  source,
  /setPreviewLoading\(true\);[\s\S]*?setEditing\(false\);[\s\S]*?setSaveError\(null\);/,
  "opening a file must reset edit state",
);

// .env (server-redacted, write-refused) and non-text previews aren't editable.
assert.match(
  source,
  /const previewEditable =[\s\S]*?preview\?\.kind === "text"[\s\S]*?startsWith\("\.env"\)/,
  "previewEditable must exclude non-text and .env files",
);

// The Edit affordance is gated on previewEditable; edit mode renders the
// CodeMirror editor (CodeEditor) bound to editValue. Cmd/Ctrl+S and Escape are
// handled inside CodeEditor's keymap (covered by code-editor.test.ts).
assert.match(source, /previewEditable &&[\s\S]*?onClick=\{startEditing\}/, "Edit button must be gated on previewEditable");
assert.match(
  source,
  /editing \? \([\s\S]*?<CodeEditor[\s\S]*?value=\{editValue\}[\s\S]*?onChange=\{setEditValue\}[\s\S]*?onSave=\{[\s\S]*?saveEdit[\s\S]*?onCancel=\{cancelEditing\}/,
  "edit mode must render CodeEditor wired to the edit state (value/onChange/onSave/onCancel)",
);

console.log("comux-view-edit.test.ts: ok");
