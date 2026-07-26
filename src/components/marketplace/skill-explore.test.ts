// @ts-nocheck
// Marketplace-hub wiring: the Skills directory merged into Explore.
// The standalone SkillBrowser surface was deleted (the Skills tab retired
// earlier, cave-vewe) — registry skills share Explore's card pool
// (SkillExploreCard), open the SkillExploreDrawer, and the hub drives the
// same debounced registry search. These assertions moved here from the
// deleted skill-browser.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hub = readFileSync(new URL("../marketplace-view.tsx", import.meta.url), "utf8");

assert.match(hub, /import \{ type SkillBrowserEntry \} from "@\/lib\/skill-directory"/, "the Marketplace hub imports the skill entry type from its canonical home");
assert.doesNotMatch(hub, /<SkillBrowser\b/, "the standalone Skills tab (SkillBrowser) stays retired from the hub");
assert.doesNotMatch(hub, /@\/components\/skill-browser/, "nothing imports the deleted skill-browser module");
assert.match(hub, /<SkillExploreCard\b/, "registry skills render as Explore cards");
assert.match(
  hub,
  /key=\{`skill:\$\{s\.slug \?\? sourceTarget\(s\)\}:\$\{s\.id\}`\}/,
  "Explore keys skills by source and id because directory ids are publisher-scoped",
);
assert.match(hub, /<SkillExploreDrawer\b/, "opening a skill card shows the Explore skill drawer");
assert.match(hub, /`\/api\/skills\/directory\?q=\$\{encodeURIComponent\(trimmed\)\}`/, "skill search reloads through the registry search endpoint");
assert.match(hub, /window\.setTimeout\(\(\) => \{[\s\S]*?void loadSkills\(query\);[\s\S]*?\}, query\.trim\(\) \? 250 : 0\)/, "skill search uses a small debounce before reloading remote results");
assert.match(
  hub,
  /invalidateSurfaceResources\("marketplace:skills"\);\s*void loadSkills\(query\);/,
  "a skill mutation invalidates the warm list before re-scanning",
);
assert.doesNotMatch(hub, /import \{ SkillCard \}/, "the old flat SkillCard list stays retired");
assert.doesNotMatch(hub, /id="marketplace-panel-skills"/, "the standalone Skills tabpanel is gone");

console.log("skill-explore.test.ts OK");
