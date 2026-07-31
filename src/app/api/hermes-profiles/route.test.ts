// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listHermesProfiles } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /\["profile", "list"\]/, "profiles use Hermes's documented list argv");
assert.match(source, /\["profile", "show", id\]/, "profile metadata uses safe argv, never a shell string");
assert.match(source, /\["profile", "describe", id\]/, "profile descriptions use the documented read-only argv");
assert.doesNotMatch(source, /profile", "use/, "discovery must not mutate Hermes's sticky active profile");
assert.match(source, /MAX_DISCOVERED_HERMES_PROFILES = 32/, "discovery caps the accepted profile list");
assert.match(source, /MAX_CONCURRENT_PROFILE_DISCOVERY = 2/, "discovery has a small bounded worker pool");
assert.match(source, /PROFILE_DISCOVERY_DEADLINE_MS = 5_000/, "discovery has an overall deadline");
assert.match(source, /Promise\.race\(/, "a slow profile registry cannot keep the endpoint open past its deadline");

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

let activeMetadataCalls = 0;
let peakMetadataCalls = 0;
const bounded = await listHermesProfiles({
  command: "hermes",
  homeDir: "/home/cave",
  run: async (_command, args) => {
    if (args.join(" ") === "profile list") {
      return ["alpha", "bravo", "charlie", "delta", "echo"].join("\n");
    }
    activeMetadataCalls++;
    peakMetadataCalls = Math.max(peakMetadataCalls, activeMetadataCalls);
    await new Promise((resolve) => setTimeout(resolve, 2));
    activeMetadataCalls--;
    return args[1] === "show"
      ? "Path: /home/cave/.hermes/profiles/" + args[2] + "\n"
      : null;
  },
  readSoul: async () => null,
});
assert.equal(bounded.profiles.length, 5);
assert.ok(peakMetadataCalls <= 4, "two queued profile entries permit at most four metadata CLI calls");

const cappedCalls: string[][] = [];
const capped = await listHermesProfiles({
  command: "hermes",
  homeDir: "/home/cave",
  maxProfiles: 3,
  run: async (_command, args) => {
    cappedCalls.push(args);
    if (args.join(" ") === "profile list") return ["alpha", "bravo", "charlie", "delta"].join("\n");
    return args[1] === "show" ? "Path: /home/cave/.hermes/profiles/" + args[2] + "\n" : null;
  },
  readSoul: async () => null,
});
assert.equal(capped.profiles.length, 3, "test seam proves the accepted profile list is capped before metadata fan-out");
assert.equal(cappedCalls.length, 7, "only three profiles receive show and describe calls");

const deadlineCalls: string[][] = [];
const expired = await listHermesProfiles({
  command: "hermes",
  deadlineMs: 0,
  run: async (_command, args) => {
    deadlineCalls.push(args);
    return args.join(" ") === "profile list" ? "alpha" : "Path: /home/cave/.hermes/profiles/alpha";
  },
});
assert.deepEqual(expired.profiles, [], "an expired discovery deadline starts no profile metadata work");
assert.deepEqual(deadlineCalls, [["profile", "list"]]);
const unavailable = await listHermesProfiles({ command: "hermes", run: async () => null });
assert.deepEqual(unavailable.profiles, [], "a missing or unconfigured CLI returns an empty profile list");
assert.match(unavailable.hint ?? "", /Couldn't list Hermes profiles/, "the empty failure state explains how to recover");
