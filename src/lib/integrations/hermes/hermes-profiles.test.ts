// @ts-nocheck
import assert from "node:assert/strict";
import {
  normalizeHermesProfileBinding,
  hermesProfileDaemonLaunchBlockReason,
  parseHermesProfileDescription,
  parseHermesProfileHome,
  parseHermesProfileList,
  soulDescription,
  summarizeHermesProfile,
} from "./hermes-profiles.ts";

assert.deepEqual(parseHermesProfileList("  default\n* work\n  research\nProfile   Model\n../escape\n"), ["research", "work"]);
assert.equal(parseHermesProfileHome("Profile: work\nPath: ~/.hermes/profiles/work\n", "/home/cave"), "/home/cave/.hermes/profiles/work");
assert.equal(parseHermesProfileHome("Path: relative/profile", "/home/cave"), null);
assert.equal(parseHermesProfileHome("Path: /tmp/profile/../../private", "/home/cave"), null);
assert.equal(parseHermesProfileHome("Path: ~/.hermes/profiles/research", "/home/cave", "work"), null);
assert.equal(soulDescription("# Soul\n\nBuilds careful things.\n"), "Builds careful things.");
assert.equal(parseHermesProfileDescription("Routes research tasks carefully.\n"), "Routes research tasks carefully.");
assert.equal(parseHermesProfileDescription("(no description set for 'work')"), null);
assert.deepEqual(normalizeHermesProfileBinding({ id: "work", homePath: "/home/cave/.hermes/profiles/work" }), { id: "work", homePath: "/home/cave/.hermes/profiles/work" });
assert.equal(normalizeHermesProfileBinding({ id: "../work", homePath: "/tmp/work" }), undefined);
assert.equal(normalizeHermesProfileBinding({ id: "work", homePath: "relative" }), undefined);
assert.equal(normalizeHermesProfileBinding({ id: "work", homePath: "/tmp/profile/../../private" }), undefined);
assert.equal(normalizeHermesProfileBinding({ id: "work", homePath: "/tmp/arbitrary-work" }), undefined);
assert.match(
  hermesProfileDaemonLaunchBlockReason({ harness: "hermes", hermesProfile: { id: "work", homePath: "/home/cave/.hermes/profiles/work" } }) ?? "",
  /cannot pass that profile to Hermes/,
);
assert.match(hermesProfileDaemonLaunchBlockReason({ hasInvalidHermesProfileBinding: true }) ?? "", /binding is invalid/);
assert.equal(
  normalizeHermesProfileBinding({ id: "work", homePath: "/" + "/".repeat(20_000) + "not-a-profile" }),
  undefined,
  "a slash-heavy untrusted profile home is rejected without regex backtracking",
);
assert.deepEqual(summarizeHermesProfile({ id: "research-lane", homePath: "/profiles/research-lane", soulMarkdown: "# SOUL\n\nResearches sources." }), {
  id: "research-lane", displayName: "Research Lane", role: "Researches sources.", description: "Researches sources.", homePath: "/profiles/research-lane",
});
