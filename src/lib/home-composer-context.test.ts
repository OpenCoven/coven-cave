// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../components/home-composer.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  source,
  /home-composer-context/,
  "Home no longer imports independent project or familiar authority helpers",
);
assert.match(
  source,
  /familiars\.find\(\(familiar\) => familiar\.id === actingFamiliarId\) \?\? null/,
  "Home looks up only the actor resolved by the shell",
);
assert.doesNotMatch(
  source,
  /familiars\[0\]|recentChatProjectRoot|resolveHomeComposerProject/,
  "Home never falls back to the first familiar or a recent project",
);

console.log("home-composer-context.test.ts: ok");
