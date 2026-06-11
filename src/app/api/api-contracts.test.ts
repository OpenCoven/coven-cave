// @ts-nocheck
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiRoot = path.join(root, "src", "app", "api");

type RouteContract = {
  route: string;
  methods: string[];
  kind: "json" | "stream";
  readsJson?: boolean;
  invalidJson?: "guarded" | "fallback-empty" | "legacy-unhandled";
  pathGuard?: boolean;
  localOriginGuard?: boolean;
};

const contracts: RouteContract[] = [
  { route: "/board/[id]/chat", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/board/[id]/lifecycle", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/enrich-steps", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/board", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/capabilities", methods: ["GET"], kind: "json" },
  { route: "/chat/conversation/[id]", methods: ["GET", "POST", "PUT", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/send", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/codex-automations/[id]", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/codex-automations", methods: ["GET"], kind: "json" },
  { route: "/config", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/coven-calls", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/coven-memory", methods: ["GET"], kind: "json" },
  { route: "/coven-status", methods: ["GET"], kind: "json" },
  { route: "/coven/exec", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/daemon/start", methods: ["POST"], kind: "json" },
  { route: "/daemon/status", methods: ["GET"], kind: "json" },
  { route: "/escalations/[id]", methods: ["PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/escalations", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/familiars/[id]/icon", methods: ["PUT"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/familiars", methods: ["GET"], kind: "json" },
  { route: "/github/activity", methods: ["GET"], kind: "json" },
  { route: "/github/assigned", methods: ["GET"], kind: "json" },
  { route: "/github/pat", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/github/tasks", methods: ["GET"], kind: "json" },
  { route: "/harnesses", methods: ["GET"], kind: "json" },
  { route: "/inbox/[id]/dismiss", methods: ["POST"], kind: "json" },
  { route: "/inbox/[id]/done", methods: ["POST"], kind: "json" },
  { route: "/inbox/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/inbox/[id]/snooze", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/inbox/prefs", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/inbox", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox/stream", methods: ["GET"], kind: "stream" },
  { route: "/launch", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/library/all", methods: ["GET"], kind: "json" },
  { route: "/library/bookmarks", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true },
  { route: "/library/doc", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/library/github", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true },
  { route: "/library/graph", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/library/pdf", methods: ["GET"], kind: "stream" },
  { route: "/library/reading", methods: ["GET", "POST", "PATCH", "DELETE"], kind: "json", readsJson: true },
  { route: "/library/route-link", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/library", methods: ["GET"], kind: "json" },
  { route: "/marketplace", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/mobile-handoff", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/memory/file", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/memory/inspector", methods: ["GET"], kind: "json" },
  { route: "/memory", methods: ["GET"], kind: "json" },
  { route: "/onboarding/setup", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/onboarding/status", methods: ["GET"], kind: "json" },
  { route: "/openclaw-agents", methods: ["GET"], kind: "json" },
  { route: "/project-file", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/project-tree", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/roles", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/salem", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/sessions/[id]/events", methods: ["GET"], kind: "json" },
  { route: "/sessions/[id]/input", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/[id]/kill", methods: ["POST"], kind: "json" },
  { route: "/sessions/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/list", methods: ["GET"], kind: "json" },
  { route: "/sessions/prune", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/sessions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/skills/eval-loop/[familiarId]", methods: ["GET"], kind: "json" },
  { route: "/skills/eval-loop/[familiarId]/run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/skills/local", methods: ["GET"], kind: "json" },
  { route: "/skills", methods: ["GET"], kind: "json" },
  { route: "/vault", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/voice/session", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/voice/transcript", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/workflows/dry-run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/workflows/validate", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/workflows", methods: ["GET"], kind: "json" },
];

function walkRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) found.push(...walkRoutes(full));
    if (stat.isFile() && entry === "route.ts") found.push(full);
  }
  return found.sort();
}

function routeFromFile(file: string): string {
  const rel = path.relative(apiRoot, path.dirname(file));
  return "/" + rel.split(path.sep).join("/");
}

function exportedMethods(source: string): string[] {
  return [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
}

function usesJsonResponse(source: string): boolean {
  return /NextResponse\.json|Response\.json|new Response\(/.test(source);
}

const routeFiles = walkRoutes(apiRoot);
const actualRoutes = routeFiles.map(routeFromFile).sort();
const contractRoutes = contracts.map((contract) => contract.route).sort();

assert.deepEqual(actualRoutes, contractRoutes, "every src/app/api route must have an API contract entry");

for (const contract of contracts) {
  const file = path.join(apiRoot, ...contract.route.slice(1).split("/"), "route.ts");
  const source = readFileSync(file, "utf8");

  assert.deepEqual(exportedMethods(source), contract.methods, `${contract.route} HTTP method exports changed`);
  assert.equal(usesJsonResponse(source), true, `${contract.route} must return an explicit Response/NextResponse`);

  const readsJson = /req\.json\(\)/.test(source);
  assert.equal(readsJson, contract.readsJson === true, `${contract.route} req.json() contract changed`);

  if (contract.invalidJson === "guarded") {
    assert.match(source, /invalid json|invalid JSON/, `${contract.route} must preserve invalid-JSON handling`);
  }
  if (contract.invalidJson === "fallback-empty") {
    assert.match(source, /let body:[\s\S]{0,160}=\s*\{\}/, `${contract.route} must initialize an optional request body`);
    assert.match(source, /try\s*\{[\s\S]{0,120}req\.json\(\)[\s\S]{0,80}\}\s*catch\s*\{/, `${contract.route} must preserve optional-body malformed JSON fallback`);
  }
  if (contract.invalidJson === "legacy-unhandled") {
    assert.doesNotMatch(source, /invalid json|invalid JSON/, `${contract.route} legacy invalid-JSON behavior changed`);
  }
  if (contract.pathGuard) {
    assert.match(source, /path not allowed|collection path not allowed/, `${contract.route} must preserve path-deny errors`);
    assert.match(source, /status:\s*403/, `${contract.route} path guard must preserve 403 response`);
  }
  if (contract.localOriginGuard) {
    assert.match(source, /isLocalOrigin/, `${contract.route} must preserve local-origin guard`);
    assert.match(source, /status:\s*403/, `${contract.route} local-origin guard must preserve 403 response`);
  }
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.match(packageJson.scripts?.["test:api"] ?? "", /api-contracts\.test\.ts/, "package.json must expose this API contract suite");

console.log(`api-contracts.test.ts: ${contracts.length} route contracts passed`);
