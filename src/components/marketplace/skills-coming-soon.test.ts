// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./skills-coming-soon.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/globals/surface-marketplace.css", import.meta.url), "utf8");

assert.match(component, /Skills worth summoning\./, "the preview has one characteristic thesis");
assert.match(component, /A smaller, reviewed skills marketplace is taking shape\./);
assert.match(component, /<ol className="marketplace-coming-soon__shelf"/, "the real review order is semantic");
for (const step of ["Review the source", "Verify the behavior", "Publish for familiars"]) {
  assert.match(component, new RegExp(step), `${step} is part of the curation path`);
}
assert.match(component, /onViewOwnedSkills/, "the preview returns to the user's skills");
assert.match(component, /onBuildSkill/, "the preview opens local authoring");
assert.match(css, /\.marketplace-coming-soon__slot\s*\{[\s\S]*border-style:\s*dashed/, "future shelf slots use invitation grammar");
assert.match(css, /@container marketplace \(max-width: 640px\)[\s\S]*marketplace-coming-soon__shelf/, "the shelf responds to pane width");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*marketplace-coming-soon__slot/, "entrance motion has a reduced-motion state");
assert.doesNotMatch(component, /installs|Official|Community|release date/i, "the preview contains no fake catalog proof");

console.log("skills-coming-soon.test.ts: ok");
