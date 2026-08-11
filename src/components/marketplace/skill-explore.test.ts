// @ts-nocheck
// Marketplace-hub wiring for locally owned skills.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hub = readFileSync(new URL("../marketplace-view.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./skill-explore-card.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("./skill-explore-drawer.tsx", import.meta.url), "utf8");
const warmup = readFileSync(new URL("../../lib/surface-warmup-registry.ts", import.meta.url), "utf8");
const directoryRoute = readFileSync(new URL("../../app/api/skills/directory/route.ts", import.meta.url), "utf8");

assert.match(hub, /import \{ type SkillBrowserEntry \} from "@\/lib\/skill-directory"/, "the Marketplace hub imports the skill entry type from its canonical home");
assert.doesNotMatch(hub, /<SkillBrowser\b/, "the standalone Skills tab (SkillBrowser) stays retired from the hub");
assert.doesNotMatch(hub, /@\/components\/skill-browser/, "nothing imports the deleted skill-browser module");
assert.match(hub, /<SkillExploreCard\b/, "local skills render as owned-inventory cards");
assert.match(
  hub,
  /key=\{`skill:\$\{skill\.local\?\.path \?\? skill\.path \?\? skill\.slug \?\? skill\.id\}:\$\{skill\.id\}`\}/,
  "Yours keys local skills by their scanned path and id",
);
assert.match(hub, /key=\{exploreSkill\?\.local\?\.path \?\? exploreSkill\?\.path \?\? exploreSkill\?\.id \?\? "none"\}/, "the owned skill drawer remounts when a duplicate-id local path changes");
assert.match(hub, /<SkillExploreDrawer\b/, "opening a skill card shows the owned-skill drawer");
assert.match(hub, /<SkillsComingSoon\b/, "Skills has a dedicated Coming Soon destination");
assert.match(hub, /const viewOwnedSkills = useCallback/, "Coming Soon and Build can return to owned skills");
assert.match(hub, /readSurfaceResource<[\s\S]*>\("marketplace:skills", force\)/, "Marketplace loads skills only from its local warm resource");
assert.doesNotMatch(hub, /\/api\/skills\/directory\?q=|toggleSkill|onToggleInstall/, "Marketplace has no remote search or skill installation path");
assert.match(
  hub,
  /invalidateSurfaceResources\("marketplace:skills"\);\s*void loadSkills\(true\);/,
  "a skill mutation invalidates the warm list before re-scanning",
);
assert.doesNotMatch(hub, /import \{ SkillCard \}/, "the old flat SkillCard list stays retired");
assert.match(card, /Local skill/, "owned skill cards state their local source");
assert.match(card, /onOpen/, "owned skill cards remain inspectable");
assert.doesNotMatch(card, /installsAllTime|Official|Community|onToggleInstall/, "owned cards contain no discovery proof or install action");
assert.match(drawer, /\/api\/skills\/file\?path=/, "owned detail previews only an allow-listed local file");
assert.match(drawer, /Delete this local skill/, "owned detail retains guarded deletion");
assert.match(drawer, /Skill prompt copied/, "owned detail retains the prompt action");
assert.doesNotMatch(drawer, /installCommand|registryUrl|Install skill|onInstallToggle/, "owned detail has no remote installation path");
assert.match(warmup, /"marketplace:skills"[\s\S]*"\/api\/skills\/directory\?scope=local"/);
assert.match(directoryRoute, /params\.get\("scope"\) === "local"[\s\S]*listLocalSkillDirectoryEntries/);

console.log("skill-explore.test.ts OK");
