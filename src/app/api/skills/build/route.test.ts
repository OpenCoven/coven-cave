// @ts-nocheck
// The Build tab's write endpoint creates files on the user's machine — its
// security posture (local-origin gate, body cap, creation-only writes inside
// known roots, no shell) is what these assertions pin down.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const lib = readFileSync(new URL("../../../../lib/server/skill-build.ts", import.meta.url), "utf8");
const format = readFileSync(new URL("../../../../lib/skill-build-format.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "skill authoring is local-origin gated");
assert.match(route, /readJsonBody<BuildBody>\(req, MAX_BODY_BYTES\)/, "body is size-capped and parsed defensively");
assert.match(route, /SKILL_BUILD_ROOTS\.some/, "destination root is allow-listed before any filesystem work");
assert.match(route, /await buildSkill\(input\)/, "the route delegates to the tested writer, no ad-hoc fs code");
assert.match(
  route,
  /result\.code === "invalid" \? 400 : result\.code === "exists" \? 409 : 500/,
  "validation → 400, duplicate id → 409, IO failure → 500",
);
assert.doesNotMatch(route, /child_process|execFile|spawn/, "authoring never shells out");

assert.match(format, /replace\(\/\[\^a-z0-9-\]\/g, ""\)/, "slugs are constrained to [a-z0-9-], so they cannot traverse");
assert.match(lib, /code: "exists"/, "existing skill dirs are refused, never overwritten");
assert.match(lib, /writeFileAtomic\(filePath, composeSkillMd\(input\)\)/, "SKILL.md lands atomically");
assert.match(lib, /path\.join\(home, "\.claude", "skills"\)/, "claude root matches the scanner's root");
assert.match(lib, /path\.join\(home, "\.codex", "skills"\)/, "codex root matches the scanner's root");
assert.match(lib, /path\.join\(home, "\.agents", "skills"\)/, "agents root matches the scanner's root");
assert.match(lib, /covenHome\(\), "skills"/, "coven root matches the scanner's root");

console.log("skills/build route.test.ts OK");
