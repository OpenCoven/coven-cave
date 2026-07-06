// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Settings → Familiars section (cave-i7y): the daemon-offline 503 must never
// masquerade as "no familiars", and familiars are creatable from Settings.
const shell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const section = shell.slice(shell.indexOf("function FamiliarsSection"));

assert.match(
  section,
  /res\.status === 503[\s\S]{0,80}setDaemonDown\(true\)/,
  "a 503 roster response must flip the daemon-down state, not render an empty roster",
);
assert.match(
  section,
  /if \(daemonDown\)[\s\S]{0,1500}Start daemon/,
  "the daemon-down state must offer a Start-daemon action",
);
assert.match(
  section,
  /familiars\.length === 0[\s\S]{0,1500}Create familiar/,
  "the genuinely-empty state must offer a Create-familiar action",
);
assert.match(
  section,
  /CreateFamiliarDialog/,
  "Settings should reuse the shared CreateFamiliarDialog",
);
assert.match(
  section,
  /onCreated=\{[\s\S]{0,300}openFamiliarStudio\(id\)/,
  "a created familiar must be selected in the studio, not left on the first roster entry",
);
assert.match(
  section,
  /onCreated=\{[\s\S]{0,300}void load\(\)/,
  "creation must refresh the roster via the extracted load()",
);

console.log("settings-familiars-section.test.ts: ok");
