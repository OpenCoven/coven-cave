// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-brain-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioBrainTab/);
assert.match(source, /harness/);
assert.match(source, /model/);
assert.match(
  source,
  /catalogForRuntime/,
  "Brain tab model menu should source options from the runtime → provider catalog",
);
assert.match(
  source,
  /modelOptions\.map/,
  "Brain tab should render a model select from the catalog options",
);
assert.match(
  source,
  /allowCustomModel/,
  "Brain tab should keep a free-text fallback for ids not in the curated catalog",
);
assert.match(source, /note/);
assert.match(source, /\/api\/harnesses/);
assert.match(source, /\/api\/config/);
assert.match(source, /method.*PATCH/);
assert.match(
  source,
  /\/api\/capabilities\?harness=/,
  "Brain tab should fetch the daemon capabilities manifest for the selected harness",
);
assert.match(
  source,
  /familiar-studio-brain__capabilities/,
  "Brain tab should expose a per-familiar capabilities accordion",
);

console.log("familiar-studio-brain-tab.test.ts: ok");
