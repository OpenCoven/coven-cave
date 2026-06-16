// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudio/, "Must export FamiliarStudio");
assert.match(source, /useFamiliarStudio/, "Must consume FamiliarStudio context");
assert.match(source, /activeFamiliarId/, "Reads activeFamiliarId from context");
assert.match(source, /Escape/, "Esc dismiss is wired");
assert.match(source, /familiar-studio__drawer/, "Drawer root class must be present");
assert.match(source, /familiar-studio__tabstrip/, "Tab strip class must be present");
assert.match(source, /role="dialog"/, "Drawer must have dialog role for a11y");
assert.match(source, /aria-label/, "Drawer must have an accessible name");
assert.match(source, /function HeaderName/, "Header must use inline-edit HeaderName component");
assert.match(source, /Click to rename/, "Static name button must hint at edit affordance");
assert.match(source, /familiar-studio__name--editing/, "Editing-state class must exist");
assert.match(source, /useDaemonSyncStatus/, "Footer subscribes to daemon sync status");
assert.match(source, /Saved locally, daemon offline/, "Daemon-offline indicator text present");

assert.match(
  source,
  /<FamiliarStudioLookTab familiar=\{familiar\} allFamiliars=\{resolved\} \/>/,
  "Familiar Studio should pass all resolved familiars to the Look tab for group color assignment",
);

assert.match(
  source,
  /const tablistRef = useRef[\s\S]*if \(!drawerOpen\) return null/,
  "Familiar Studio should call tabstrip hooks before early returns to keep hook order stable",
);

// The header avatar is a click-to-upload control wired to the shared image hook.
assert.match(
  source,
  /<StudioHeaderAvatar familiar=\{familiar\} \/>/,
  "Header renders the upload-capable avatar instead of a static one",
);
assert.match(
  source,
  /function StudioHeaderAvatar[\s\S]*useFamiliarImageUpload\(familiar\.id\)/,
  "Header avatar uploads via the shared image hook",
);
assert.match(
  source,
  /function StudioHeaderAvatar[\s\S]*inputRef\.current\?\.click\(\)[\s\S]*type="file"/,
  "Clicking the header avatar opens a hidden file picker",
);

// The Contract tab (Familiar Contract adherence check) is registered and mounted.
assert.match(source, /id: "contract"/, "Studio registers the Contract tab in TABS");
assert.match(
  source,
  /activeTab === "contract" && familiar \? \(\s*<FamiliarStudioContractTab familiar=\{familiar\} \/>/,
  "Studio mounts the Contract tab body for the active familiar",
);

console.log("familiar-studio.test.ts: ok");
