// The Build tab is the Marketplace's skill-authoring surface — these
// assertions pin its section wiring, the form → API contract, the shared
// preview/writer formatter, and the CTA reroute away from the old
// Capabilities dead-end.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("../marketplace-view.tsx", import.meta.url), "utf8");
const builder = await readFile(new URL("./skill-builder.tsx", import.meta.url), "utf8");
const browser = await readFile(new URL("../skill-browser.tsx", import.meta.url), "utf8");
const format = await readFile(new URL("../../lib/skill-build-format.ts", import.meta.url), "utf8");

// Section wiring in the hub.
assert.match(view, /\{ id: "build", label: "Build", icon: "ph:hammer" \}/, "Build is a first-class Marketplace section");
assert.match(view, /"browse" \| "crafts" \| "roles" \| "skills" \| "build" \| "capabilities"/, "MarketplaceSection includes build");
assert.match(view, /id="marketplace-panel-build"/, "Build section has a labelled tabpanel");
assert.match(view, /aria-labelledby="marketplace-tab-build"/, "Build tabpanel is labelled by its tab");
assert.match(view, /build: "Author a new skill/, "Build has a section hint (tab tooltip)");
assert.match(view, /section !== "capabilities" && section !== "build"/, "the hub search hides on the Build section");
assert.match(view, /<SkillBuilder\s/, "the Build panel hosts the SkillBuilder surface");
assert.match(view, /onSaved=\{\(\) => void loadSkills\(""\)\}/, "a saved skill refreshes the Skills list and tab count");
assert.match(view, /onViewSkills=\{\(\) => selectSection\("skills"\)\}/, "the success panel can jump to the Skills tab");
assert.match(view, /label="Build a skill"[\s\S]{0,80}selectSection\("build"\)/, "the Browse setup rail links to Build");

// The old dead-end: creating a skill used to punt to the read-only
// Capabilities inspector.
assert.match(view, /onCreateSkill=\{\(\) => selectSection\("build"\)\}/, "the Skills tab create CTA opens Build");
assert.doesNotMatch(view, /onCreateSkill=\{\(\) => selectSection\("capabilities"\)\}/, "create-skill no longer punts to Capabilities");
assert.match(browser, /Build a skill/, "the Skills empty-state CTA is named for authoring");

// The authoring form's contract.
assert.match(builder, /fetch\("\/api\/skills\/build"/, "saving posts to the guarded build endpoint");
assert.match(builder, /composeSkillMd\(/, "the live preview uses the shared formatter");
assert.match(builder, /slugifySkillName\(name\)/, "the destination path preview derives the real slug");
assert.match(builder, /SKILL_BUILD_ROOTS\.map/, "destination roots come from the shared allow-list, not ad-hoc strings");
assert.match(builder, /announce\(`Skill \$\{json\.slug\} saved`, "polite"\)/, "successful saves are announced to AT");
assert.match(builder, /announce\(msg, "assertive"\)/, "failures are announced to AT");
assert.match(builder, /role="alert"/, "failures render an alert banner");
assert.match(builder, /Insert starter template/, "an empty instructions field offers a starter skeleton");
assert.match(builder, /aria-label="SKILL\.md preview"/, "the preview pane is a labelled region");
assert.match(builder, /disabled=\{!ready\}/, "Save stays disabled until the required fields are present");
assert.match(builder, /Build another skill/, "the success panel offers a reset path");

// Preview and writer must be the same artifact: the client imports the
// shared formatter (client-safe module), never a server-only copy.
assert.match(builder, /from "@\/lib\/skill-build-format"/, "the builder imports the shared client-safe formatter");
assert.doesNotMatch(format, /node:fs|node:os|node:path|@\/lib\/server/, "the shared formatter stays client-safe");

console.log("skill-builder.test.ts OK");
