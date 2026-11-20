import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// #6265: the Codex-automations compatibility facade may only be retired once
// every route is served by a typed Coven successor and proven against the
// released daemon. A new route, method or browser caller must be added here
// with its successor and canary marker, so the retirement inventory cannot
// silently fall behind the code.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type FacadeRoute = { route: string; methods: readonly string[]; successors: readonly string[]; canary: readonly string[] };

const FACADE: readonly FacadeRoute[] = [
  { route: "src/app/api/codex-automations/route.ts", methods: ["GET", "POST"],
    successors: ["automation-consumer-reads", "automation-consumer-commands"], canary: ["facadeReadsListGetRunsLastRunsLogImport", "createPaused"] },
  { route: "src/app/api/codex-automations/[id]/route.ts", methods: ["GET", "PATCH", "DELETE"],
    successors: ["automation-consumer-reads", "automation-consumer-commands"],
    canary: ["facadeReadsListGetRunsLastRunsLogImport", "staleSave", "journalTypedCreateReplayEditMetadataConflictDeleteOffline"] },
  { route: "src/app/api/codex-automations/[id]/definition/route.ts", methods: ["GET"],
    successors: ["automation-consumer-reads"], canary: ["conflictRebase"] },
  { route: "src/app/api/codex-automations/[id]/run/route.ts", methods: ["POST"],
    successors: ["coven-automations-client"], canary: ["runNowFailure"] },
  { route: "src/app/api/codex-automations/[id]/runs/route.ts", methods: ["GET"],
    successors: ["automation-consumer-reads"], canary: ["facadeReadsListGetRunsLastRunsLogImport"] },
  { route: "src/app/api/codex-automations/[id]/runs/[runId]/log/route.ts", methods: ["GET"],
    successors: ["automation-consumer-reads"], canary: ["facadeReadsListGetRunsLastRunsLogImport"] },
  { route: "src/app/api/codex-automations/import/route.ts", methods: ["POST"],
    successors: ["coven-automations-client"], canary: ["facadeReadsListGetRunsLastRunsLogImport"] },
  { route: "src/app/api/codex-automation-last-runs/route.ts", methods: ["GET"],
    successors: ["automation-consumer-reads"], canary: ["facadeReadsListGetRunsLastRunsLogImport"] },
];

// Browser and server modules that still address the facade by URL.
const CALLERS = [
  "src/components/automations-view.tsx",
  "src/components/automations/cron-detail-panel.tsx",
  "src/lib/automations/create-intent.ts",
  "src/lib/automations/revision-rebase.ts",
  "src/lib/research-mission-client.ts",
  "src/lib/surface-warmup-registry.ts",
].sort();

const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

test("every facade route and method is inventoried with a typed successor", () => {
  const routes = [...walk("src/app/api/codex-automations"), ...walk("src/app/api/codex-automation-last-runs")]
    .filter((file) => file.endsWith("/route.ts")).sort();
  assert.deepEqual(routes, FACADE.map((entry) => entry.route).sort());
  for (const entry of FACADE) {
    const source = read(entry.route);
    const methods = [...source.matchAll(/^export async function (GET|POST|PATCH|DELETE|PUT)\b/gmu)].map((match) => match[1]);
    assert.deepEqual(methods.sort(), [...entry.methods].sort(), entry.route);
    for (const successor of entry.successors) {
      assert.match(source, new RegExp(`from "@/lib/server/${successor}"`, "u"), `${entry.route} → ${successor}`);
    }
    // A successor is typed Coven access; the facade must not reach Codex files.
    assert.doesNotMatch(source, /codex-automations-store|\.codex\/automations|automation\.toml/u, entry.route);
  }
});

test("every facade route is proven by a released-daemon canary marker", () => {
  const canary = read("scripts/coven-automations-release-canary.ts");
  for (const entry of FACADE) {
    for (const marker of entry.canary) assert.match(canary, new RegExp(`"${marker}=`, "u"), `${entry.route} → ${marker}`);
  }
});

test("every module addressing the facade by URL is an inventoried caller", () => {
  const callers = walk("src")
    .filter((file) => /\.(ts|tsx)$/u.test(file) && !/\.test\.tsx?$/u.test(file) && !file.startsWith("src/app/api/"))
    // Comments that mention a facade path are history, not callers.
    .filter((file) => /["'`]\/api\/codex-automation/u.test(read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gmu, "")))
    .sort();
  assert.deepEqual(callers, CALLERS);
});
