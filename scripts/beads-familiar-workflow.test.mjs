import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");
const workflow = read("docs/workflows/beads-familiars.md");
const beadsConfig = read(".beads/config.yaml");
const beadsMetadata = JSON.parse(read(".beads/metadata.json"));
const beadsExport = read(".beads/issues.jsonl").trim().split("\n").map((line) => JSON.parse(line));
const beadsPreCommitHook = read(".beads/hooks/pre-commit");
const apiRoute = read("src/app/api/beads/route.ts");
const apiContracts = read("src/app/api/api-contracts.test.ts");

assert.deepEqual(
  {
    prime: packageJson.scripts["beads:prime"],
    ready: packageJson.scripts["beads:ready"],
    sync: packageJson.scripts["beads:sync"],
    doctor: packageJson.scripts["beads:doctor"],
  },
  {
    prime: "bd prime",
    ready: "bd ready --json",
    sync: "bd dolt pull && bd dolt push",
    doctor: "bd doctor && bd lint",
  },
  "package scripts should give familiars stable Beads entrypoints",
);

assert.match(agents, /Beads Issue Tracker/, "AGENTS.md should install Beads issue tracking guidance");
assert.match(agents, /Coven Familiar Beads Protocol/, "AGENTS.md should add Coven-specific familiar workflow guidance");
assert.match(agents, /bd prime[\s\S]*bd ready --json[\s\S]*bd update <id> --claim[\s\S]*bd close <id>/, "agents should learn the claim-and-close loop");
assert.doesNotMatch(agents, /Do NOT use external issue trackers/, "Cave must bridge GitHub and Linear instead of banning them");
assert.match(claude, /bd dolt push[\s\S]*git push/, "Claude session close guidance should include Beads Dolt sync before git push");

assert.equal(beadsMetadata.dolt_database, "cave", "Cave Beads IDs should use the short cave- prefix");
assert.match(beadsConfig, /sync\.remote:\s+"git\+https:\/\/github\.com\/OpenCoven\/coven-cave\.git"/, "Beads should be configured for Dolt sync through origin");
assert.equal(beadsExport.length, 4, "the review export should include the dogfood epic, active task, and two follow-ups");
assert.deepEqual(
  beadsExport.map((issue) => issue.id).sort(),
  ["cave-hlv", "cave-hlv.1", "cave-hlv.2", "cave-hlv.3"],
  "the review export should preserve the dogfood bead IDs",
);
assert.doesNotMatch(
  read(".beads/issues.jsonl"),
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  "the committed review export should not publish local git actor emails",
);

assert.match(workflow, /Familiar Work Queue/, "workflow doc should name the Cave-facing work queue");
assert.match(workflow, /GitHub and Linear remain visibility layers/, "workflow doc should preserve external tracker visibility");
assert.match(workflow, /bd ready --json[\s\S]*bd update <id> --claim[\s\S]*bd close <id>/, "workflow doc should explain the familiar loop");
assert.match(workflow, /No secrets in bead text/, "workflow doc should include the privacy guardrail");
assert.match(workflow, /\.beads\/issues\.jsonl is an export, not the sync protocol/, "workflow doc should prevent JSONL sync misuse");
assert.match(workflow, /public-scrubbed before committing/, "workflow doc should require public-safe JSONL review exports");
assert.match(workflow, /bd dolt pull[\s\S]*bd dolt push/, "workflow doc should name Dolt sync commands");
assert.doesNotMatch(
  beadsPreCommitHook,
  /info "ok \(\$\{#STAGED_FILES\[@\]\} files scanned\)"\nexit 0[\s\S]*BEGIN BEADS INTEGRATION/,
  "the repo pre-commit scan must not exit before the managed Beads hook runs",
);

assert.match(apiContracts, /\{ route: "\/beads", methods: \["GET", "POST"\]/, "the Beads API route must be covered by route contracts");
assert.match(apiRoute, /export async function GET/, "Beads route should expose GET for ready/show/prime reads");
assert.match(apiRoute, /export async function POST/, "Beads route should expose POST for claim/comment/close mutations");
assert.match(apiRoute, /export async function GET[\s\S]*rejectNonLocalRequest\(req\)/, "Beads reads must stay local-only");
assert.match(apiRoute, /export async function POST[\s\S]*rejectNonLocalRequest\(req\)/, "Beads mutations must stay local-only");
assert.match(apiRoute, /id required for mode=show/, "explicit show requests should fail clearly when id is missing");
assert.match(apiRoute, /readJsonBody<[\s\S]*MAX_SESSION_JSON_BYTES/, "Beads mutations must use the bounded JSON body helper");
assert.match(apiRoute, /execFileAsync\("bd"/, "Beads route should call bd through argv arrays, not shell strings");
assert.match(apiRoute, /case "claim":[\s\S]*"--claim"/, "Beads POST should support atomic familiar claiming");
assert.match(apiRoute, /case "comment":[\s\S]*"comments"[\s\S]*"add"/, "Beads POST should support session handoff comments");
assert.match(apiRoute, /case "close":[\s\S]*"close"/, "Beads POST should support closing completed work");
assert.doesNotMatch(apiRoute, /issues\.jsonl/, "Cave API must not read .beads/issues.jsonl as the source of truth");

console.log("beads-familiar-workflow.test.mjs: ok");
