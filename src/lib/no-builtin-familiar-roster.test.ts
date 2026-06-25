import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  "src/lib/demo-seed.ts",
  "src/lib/flow/flow-templates.ts",
  "src/components/workspace.tsx",
  "src/components/settings-shell.tsx",
  "src/components/familiar-pin-order.tsx",
  "automations/familiar-weekly-reflection.toml",
  "automations/familiar-daily-notes.toml",
  "src/app/api/library/route.ts",
  "src/app/api/library/chat/route.ts",
  "src/app/api/library/chat/chat-doc-path.ts",
  "src/app/api/library/doc/route.ts",
  "src/app/api/library/doc/doc-file.ts",
  "src/components/library-doc-preview.tsx",
  "src/components/library-chat-panel.tsx",
];

const forbidden = /\b(nova|kitty|cody|sage|echo|charm|astra)\b/i;

for (const file of files) {
  const source = await readFile(file, "utf8").catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  });
  if (source == null) continue;
  assert.doesNotMatch(source, forbidden, `${file} must not hard-code Val's familiar roster`);
}

console.log("no-builtin-familiar-roster.test.ts OK");
