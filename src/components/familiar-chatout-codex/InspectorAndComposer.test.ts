// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inspectorSource = readFileSync(new URL("./EnvironmentInspector.tsx", import.meta.url), "utf8");
const subagentsSource = readFileSync(new URL("./SubagentsList.tsx", import.meta.url), "utf8");
const sourcesSource = readFileSync(new URL("./SourcesList.tsx", import.meta.url), "utf8");
const composerSource = readFileSync(new URL("./FollowUpComposer.tsx", import.meta.url), "utf8");
const mockSource = readFileSync(new URL("./mockInspector.ts", import.meta.url), "utf8");

assert.match(inspectorSource, /export function EnvironmentInspector/, "EnvironmentInspector should be exported");
assert.match(inspectorSource, /Changes/, "Environment inspector should include a Changes row");
assert.match(inspectorSource, /Local/, "Environment inspector should include a Local row");
assert.match(inspectorSource, /Commit/, "Environment inspector should include a Commit row");

assert.match(subagentsSource, /FamiliarAvatar/, "SubagentsList should reuse FamiliarAvatar");
assert.match(subagentsSource, /statusDot/, "SubagentsList should render status dots");

assert.match(sourcesSource, /No sources yet/, "SourcesList should expose the empty state");

assert.match(composerSource, /Ask for follow-up changes/, "Composer should use the requested placeholder");
assert.match(composerSource, /Custom/, "Composer should include the Custom pill");
assert.match(composerSource, /5\.5 High/, "Composer should include the requested model picker text");

assert.match(mockSource, /feat\/familiar-chatout-codex/, "Inspector mock should use the feature branch");
assert.match(mockSource, /Push pending/, "Inspector mock should include push pending commit state");

console.log("InspectorAndComposer.test.ts: ok");
