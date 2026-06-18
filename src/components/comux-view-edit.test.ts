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

// The Edit affordance is gated on previewEditable; the textarea is bound to editValue.
assert.match(source, /previewEditable &&[\s\S]*?onClick=\{startEditing\}/, "Edit button must be gated on previewEditable");
assert.match(source, /<textarea[\s\S]*?value=\{editValue\}[\s\S]*?onChange=\{\(e\) => setEditValue/, "edit mode must render a textarea bound to editValue");

// Keyboard: Cmd/Ctrl+S saves, Escape cancels.
assert.match(
  source,
  /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "s"[\s\S]*?saveEdit\(\)/,
  "Cmd/Ctrl+S must save",
);
assert.match(source, /e\.key === "Escape"[\s\S]*?cancelEditing\(\)/, "Escape must cancel editing");

console.log("comux-view-edit.test.ts: ok");
