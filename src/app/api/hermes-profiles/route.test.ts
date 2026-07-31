// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listHermesProfiles } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /\["profile", "list"\]/, "profiles use Hermes's documented list argv");
assert.match(source, /\["profile", "show", id\]/, "profile metadata uses safe argv, never a shell string");
assert.match(source, /\["profile", "describe", id\]/, "profile descriptions use the documented read-only argv");
assert.doesNotMatch(source, /profile", "use/, "discovery must not mutate Hermes's sticky active profile");

const calls: string[][] = [];
const result = await listHermesProfiles({
  command: "hermes",
  homeDir: "/home/cave",
  run: async (_command, args) => {
    calls.push(args);
    if (args.join(" ") === "profile list") return "* work\n  research\n";
    if (args[1] === "describe") return args[2] === "research" ? "Researches documented behavior.\n" : null;
    if (args[2] === "work") return "Path: ~/.hermes/profiles/work\n";
    return "Path: ~/.hermes/profiles/research\n";
  },
  readSoul: async (homePath) => homePath.endsWith("work") ? "# SOUL\n\nBuilds product features." : null,
});
assert.deepEqual(calls, [["profile", "list"], ["profile", "show", "research"], ["profile", "describe", "research"], ["profile", "show", "work"], ["profile", "describe", "work"]]);
assert.equal(result.profiles[1]?.role, "Builds product features.");
assert.equal(result.profiles[0]?.role, "Researches documented behavior.");
assert.equal(result.profiles[0]?.homePath, "/home/cave/.hermes/profiles/research");

const unavailable = await listHermesProfiles({ command: "hermes", run: async () => null });
assert.deepEqual(unavailable.profiles, [], "a missing or unconfigured CLI returns an empty profile list");
assert.match(unavailable.hint ?? "", /Couldn't list Hermes profiles/, "the empty failure state explains how to recover");
