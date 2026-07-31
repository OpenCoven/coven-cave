// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-context.tsx", import.meta.url), "utf8");

assert.match(source, /export.*FamiliarStudioProvider/, "Provider must be exported");
assert.match(source, /export.*useFamiliarStudio/, "Hook must be exported");
assert.match(source, /openFamiliarStudio/, "Hook returns openFamiliarStudio");
assert.match(source, /closeFamiliarStudio/, "Hook returns closeFamiliarStudio");
assert.match(source, /activeFamiliarId/, "State exposes activeFamiliarId");
assert.match(source, /activeTab/, "State exposes activeTab");
assert.match(source, /createContext/, "Uses React context");
assert.match(source, /markFamiliarSettingsPending\(chatSettingsTabFor\(tab\)\)/, "studio handoffs target Chat Familiar Settings");
assert.match(source, /setFamiliarScope\(\[familiarId\]\)/, "studio handoffs preserve the selected familiar");
assert.match(source, /window\.location\.assign\("\/\?mode=chat"\)/, "studio handoffs navigate to Chat");
assert.doesNotMatch(source, /window\.location\.assign\("\/settings#familiars"\)/, "studio handoffs no longer target retired Settings Familiars");

console.log("familiar-studio-context.test.ts: ok");
