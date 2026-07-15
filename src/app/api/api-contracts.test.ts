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
  { route: "/access-groups", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/access-groups/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/app/latest-release", methods: ["GET"], kind: "json" },
  { route: "/asana/assigned", methods: ["GET"], kind: "json" },
  { route: "/asana/workspaces", methods: ["GET"], kind: "json" },
  { route: "/asana/pat", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/beads", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/beads/prs", methods: ["GET"], kind: "json", localOriginGuard: true, pathGuard: true },
  { route: "/board/[id]/chat", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]/lifecycle", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/enrich-steps", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/board", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/canvas", methods: ["GET", "PUT", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/capabilities", methods: ["GET"], kind: "json" },
  { route: "/cave-home-migration", methods: ["GET", "POST"], kind: "json" },
  { route: "/changes", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/chat/conversation/[id]", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/model-state", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/search", methods: ["GET"], kind: "json" },
  { route: "/chat/send", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/chat/stop", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/chat/usage", methods: ["GET"], kind: "json" },
  { route: "/codex-automations/[id]", methods: ["GET", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/codex-automations/[id]/run", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/codex-automations/[id]/runs", methods: ["GET"], kind: "json" },
  { route: "/codex-automations/[id]/runs/[runId]/log", methods: ["GET"], kind: "json" },
  { route: "/codex-automations", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/config", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/coven-memory", methods: ["GET"], kind: "json" },
  { route: "/coven/exec", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/daemon/capabilities", methods: ["GET"], kind: "json" },
  { route: "/daemon/start", methods: ["POST"], kind: "json" },
  { route: "/daemon/status", methods: ["GET"], kind: "json" },
  { route: "/escalations/[id]", methods: ["PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/escalations", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/familiars/[id]/avatar", methods: ["GET", "POST"], kind: "stream", pathGuard: true },
  { route: "/familiars/[id]/backdrop", methods: ["GET", "PUT", "DELETE"], kind: "stream", localOriginGuard: true },
  { route: "/familiars/[id]/contract", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/icon", methods: ["PUT"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/familiars/[id]/notes", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/self-report", methods: ["POST", "GET"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/self-reports/[sessionId]", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/self-reports/snapshots", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/self-reports", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/response-confidence", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]", methods: ["DELETE"], kind: "json", pathGuard: true },
  { route: "/familiars/removed", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/familiars", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/feedback/message", methods: ["POST", "GET"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/fs-browse", methods: ["GET"], kind: "json", pathGuard: true, localOriginGuard: true },
  { route: "/github/activity", methods: ["GET"], kind: "json" },
  { route: "/github/assigned", methods: ["GET"], kind: "json" },
  { route: "/github/checks", methods: ["GET"], kind: "json" },
  { route: "/github/repos", methods: ["GET"], kind: "json" },
  { route: "/github/subscriptions", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/github/user", methods: ["GET"], kind: "json" },
  { route: "/flows", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/flows/run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/flows/runs", methods: ["GET", "POST", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/flows/session-transcript", methods: ["GET"], kind: "json" },
  { route: "/flows/webhook", methods: ["DELETE", "GET", "PATCH", "POST", "PUT"], kind: "json" },
  { route: "/flows/webhook/[...path]", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], kind: "json" },
  { route: "/flows/webhook-test", methods: ["DELETE", "GET", "PATCH", "POST", "PUT"], kind: "json" },
  { route: "/flows/webhook-test/[...path]", methods: ["DELETE", "GET", "PATCH", "POST", "PUT"], kind: "json" },
  { route: "/flows/webhook-test/listen", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/hosts", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/github/comment", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/comments", methods: ["GET"], kind: "json" },
  { route: "/github/commit", methods: ["GET"], kind: "json" },
  { route: "/github/dispatch", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/issue", methods: ["POST", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/item", methods: ["GET"], kind: "json" },
  { route: "/github/merge", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/rerun", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/resolve-thread", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/review", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/runs", methods: ["GET"], kind: "json" },
  { route: "/github/pat", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/github/tasks", methods: ["GET"], kind: "json" },
  { route: "/github/worktree", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grant-proposals/[id]", methods: ["PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grant-proposals", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grimoire/graph", methods: ["GET"], kind: "json" },
  { route: "/harnesses", methods: ["GET"], kind: "json" },
  { route: "/home-tweets", methods: ["GET"], kind: "json" },
  { route: "/inbox/[id]/dismiss", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/inbox/[id]/done", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/inbox/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox/[id]/snooze", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox/bulk", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox/daily-summary", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty", localOriginGuard: true },
  { route: "/inbox/prefs", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/inbox/stream", methods: ["GET"], kind: "stream" },
  { route: "/journal", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/knowledge", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/knowledge/collections", methods: ["GET"], kind: "json" },
  { route: "/knowledge/packs", methods: ["GET"], kind: "json" },
  { route: "/knowledge/packs/seed", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/launch", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/mobile-handoff", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/mobile-token/refresh", methods: ["POST"], kind: "json" },
  { route: "/mcp", methods: ["GET"], kind: "json" },
  { route: "/marketplace", methods: ["GET"], kind: "json" },
  { route: "/marketplace/config", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/marketplace/config/validate", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/marketplace/crafts/drafts", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/marketplace/crafts/install", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/marketplace/crafts/plan", methods: ["GET"], kind: "json" },
  { route: "/marketplace/crafts/uninstall", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/marketplace/install", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/marketplace/pack-prompts", methods: ["GET"], kind: "json" },
  { route: "/marketplace/uninstall", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/marketplace/validate-endpoint", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/memory/delete", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/memory/file", methods: ["GET", "PUT"], kind: "json", pathGuard: true, readsJson: true, invalidJson: "guarded" },
  { route: "/memory/inspector", methods: ["GET"], kind: "json" },
  { route: "/memory/purge", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/memory/restore", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/memory", methods: ["GET"], kind: "json" },
  { route: "/onboarding/install", methods: ["GET", "DELETE", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/onboarding/setup", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/onboarding/codex-port-preflight", methods: ["POST"], kind: "json" },
  { route: "/onboarding/ssh-check", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/onboarding/status", methods: ["GET"], kind: "json" },
  { route: "/opencoven/executions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/opencoven/submissions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/openclaw-agents", methods: ["GET"], kind: "json" },
  { route: "/opencoven-tools/status", methods: ["GET"], kind: "json" },
  { route: "/preferences/backdrop", methods: ["GET", "PUT", "DELETE"], kind: "stream", localOriginGuard: true },
  { route: "/preferences", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/project-grants", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/project-file", methods: ["GET", "POST"], kind: "json", pathGuard: true, readsJson: true, invalidJson: "guarded" },
  { route: "/project-tree", methods: ["GET", "POST"], kind: "json", pathGuard: true, readsJson: true, invalidJson: "guarded" },
  { route: "/project/files", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/project/search", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/projects/[id]", methods: ["PUT", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/projects/icon", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/projects/seed", methods: ["POST"], kind: "json" },
  { route: "/projects", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/prompt/enhance", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/profile/avatar", methods: ["GET", "POST", "DELETE"], kind: "stream", readsJson: true, invalidJson: "guarded" },
  { route: "/profile", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/prompts", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/roles", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/roles/crafts", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/roles/workflows", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/research/links", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/research/missions/[id]/actions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions/[id]/schedule", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions/[id]", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/research/missions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/retro-runs", methods: ["GET"], kind: "json" },
  { route: "/rss", methods: ["GET"], kind: "json" },
  { route: "/salem", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/salem/pathfinder", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/salem/pathfinder/feedback", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/[id]/events", methods: ["GET"], kind: "json" },
  { route: "/sessions/[id]/input", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/[id]/kill", methods: ["POST"], kind: "json" },
  { route: "/sessions/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/list", methods: ["GET"], kind: "json" },
  { route: "/sessions/prune", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/sessions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/skills/file", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/skills/eval-loop/[familiarId]", methods: ["GET"], kind: "json" },
  { route: "/skills/directory", methods: ["GET"], kind: "json" },
  { route: "/skills/build", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/draft", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/caveman", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/dry-run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/templates", methods: ["GET"], kind: "json" },
  { route: "/skills/directory/[slug]", methods: ["GET"], kind: "json" },
  { route: "/skills/directory/install", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/directory/use", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills/local", methods: ["GET", "DELETE"], kind: "json" },
  { route: "/skills/packages/install", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/skills", methods: ["GET"], kind: "json" },
  { route: "/space-usage", methods: ["GET"], kind: "json" },
  { route: "/stitches", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/stitches/pins", methods: ["POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/stitches/sew", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/theme", methods: ["GET", "PUT"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/travel/client", methods: ["GET", "PATCH"], kind: "json", readsJson: true },
  { route: "/vault", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/voice/elevenlabs/catalog", methods: ["GET"], kind: "json" },
  { route: "/voice/elevenlabs/tts", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/voice/local/chat", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/voice/preview", methods: ["GET"], kind: "stream" },
  { route: "/voice/session", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/voice/transcript", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/workflows/delete", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/dry-run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/workflows/layout", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/runs", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/save", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
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
  const direct = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
  const aliases = [...source.matchAll(/^\s*[A-Za-z_$][\w$]*\s+as (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((match) => match[1]);
  return [...direct, ...aliases];
}

function usesJsonResponse(source: string): boolean {
  return /NextResponse\.json|Response\.json|new Response\(/.test(source);
}

function effectiveRouteSource(file: string, source: string): string {
  const reexport = source.match(/from\s+"(\.[^"]+\/route)";/);
  if (!reexport) return source;
  const target = path.resolve(path.dirname(file), `${reexport[1]}.ts`);
  return `${source}\n${readFileSync(target, "utf8")}`;
}

const routeFiles = walkRoutes(apiRoot);
const actualRoutes = routeFiles.map(routeFromFile).sort();
const contractRoutes = contracts.map((contract) => contract.route).sort();

assert.deepEqual(actualRoutes, contractRoutes, "every src/app/api route must have an API contract entry");

for (const contract of contracts) {
  const file = path.join(apiRoot, ...contract.route.slice(1).split("/"), "route.ts");
  const source = readFileSync(file, "utf8");
  const effectiveSource = effectiveRouteSource(file, source);

  assert.deepEqual(exportedMethods(source), contract.methods, `${contract.route} HTTP method exports changed`);
  assert.equal(usesJsonResponse(effectiveSource), true, `${contract.route} must return an explicit Response/NextResponse`);

  const readsJson = /req\.json\(\)|readJsonBody[<(]/.test(effectiveSource);
  assert.equal(readsJson, contract.readsJson === true, `${contract.route} req.json() contract changed`);

  if (contract.invalidJson === "guarded") {
    assert.match(effectiveSource, /invalid json|invalid JSON|readJsonBody/, `${contract.route} must preserve invalid-JSON handling`);
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
    assert.match(source, /isLocalOrigin|rejectNonLocalRequest/, `${contract.route} must preserve local-origin guard`);
    if (source.includes("rejectNonLocalRequest")) {
      assert.match(source, /rejectNonLocalRequest\(req\)/, `${contract.route} must call the shared local-origin guard`);
    } else {
      assert.match(source, /status:\s*403/, `${contract.route} local-origin guard must preserve 403 response`);
    }
  }
}

{
  const dailySummarySource = readFileSync(
    path.join(apiRoot, "inbox", "daily-summary", "route.ts"),
    "utf8",
  );
  assert.match(
    dailySummarySource,
    /link:\s*draft\.link/,
    "/inbox/daily-summary should persist the generated report link",
  );
  assert.match(
    dailySummarySource,
    /media:\s*draft\.media/,
    "/inbox/daily-summary should persist the generated media card",
  );
  assert.match(
    dailySummarySource,
    /broadcastUpdated\(/,
    "/inbox/daily-summary refreshes must broadcast an updated event (created would re-toast)",
  );
  assert.match(
    dailySummarySource,
    /dateMismatch/,
    "/inbox/daily-summary must reject payloads computed for a different day (midnight-rollover race)",
  );
  assert.match(
    dailySummarySource,
    /fetchMergedPrsForDay\(now\)\.catch\(/,
    "/inbox/daily-summary should gather merged PRs server-side, degrading to absent on failure",
  );
  assert.match(
    dailySummarySource,
    /loadBoard\(\)\.catch\(/,
    "/inbox/daily-summary should gather completed cards server-side, degrading to absent on failure",
  );
  assert.match(
    dailySummarySource,
    /narrative:\s*narrativeInput \?\? existing\.media\?\.narrative/,
    "/inbox/daily-summary fact refreshes must preserve the narrative layered on top",
  );
  assert.match(
    dailySummarySource,
    /function sanitizeNarrative/,
    "/inbox/daily-summary must validate client-submitted narratives before storing",
  );
  assert.match(
    dailySummarySource,
    /NARRATIVE_MAX_STORED_CHARS/,
    "/inbox/daily-summary must bound stored narrative length",
  );
  assert.match(
    dailySummarySource,
    /extractNextPaths\(input\.text\)/,
    "/inbox/daily-summary must strip the piggybacked next-paths block before storing a narrative",
  );
}

// CHAT-D5-02 (amended by cave-id5): cancelling a streaming response is an
// explicit POST /api/chat/stop — it SIGTERMs the harness and persists an
// honest cancelled record (the partial text streamed so far, or a minimal
// "(cancelled)" marker), never the fabricated empty-response error
// diagnostic. A bare `req.signal` abort is a TRANSPORT DROP, not a cancel:
// the harness keeps running (bounded by the detach cap) and the finished
// turn persists for resync. Both adapter paths (coven stream-json and the
// OpenClaw bridge) carry the guard.
{
  const sendSource = readFileSync(
    path.join(apiRoot, "chat", "send", "route.ts"),
    "utf8",
  );
  const stopReads = [
    ...sendSource.matchAll(/const cancelledByUser = runHandle\.stopRequested;/g),
  ];
  assert.equal(
    stopReads.length,
    2,
    "/chat/send: both adapter paths must detect a deliberate stop (not a bare abort) before synthesizing diagnostics",
  );
  assert.doesNotMatch(
    sendSource,
    /const cancelledByUser = (?:args\.)?req\.signal\.aborted;/,
    "/chat/send: a bare transport abort must never be read as a user cancel",
  );
  const runRegistrations = [...sendSource.matchAll(/= registerChatRun\(/g)];
  assert.equal(
    runRegistrations.length,
    2,
    "/chat/send: both adapter paths must register with the stop registry",
  );
  assert.match(
    sendSource,
    /setTimeout\(kill(?:Child|CurrentChild), CHAT_DETACH_MAX_MS\)/,
    "/chat/send: a transport drop must arm the detach cap instead of killing immediately",
  );
  const stopSource = readFileSync(
    path.join(apiRoot, "chat", "stop", "route.ts"),
    "utf8",
  );
  assert.match(
    stopSource,
    /requestChatStop/,
    "/chat/stop must resolve stops through the shared run registry",
  );
  const guardedDiagnostics = [
    ...sendSource.matchAll(
      /if \(cancelledByUser\) \{[\s\S]{0,200}?\} else if \(!assistantText\.trim\(\)\) \{/g,
    ),
  ];
  assert.equal(
    guardedDiagnostics.length,
    2,
    "/chat/send: the empty-response error diagnostic must be skipped when the user cancelled",
  );
  assert.match(
    sendSource,
    /assistantText = "\(cancelled\)"/,
    "/chat/send: an abort with no partial text must persist the minimal cancelled marker",
  );
  const cancelledFlags = [
    ...sendSource.matchAll(/\.\.\.\(cancelledByUser \? \{ cancelled: true \} : \{\}\)/g),
  ];
  assert.equal(
    cancelledFlags.length,
    2,
    "/chat/send: both adapter paths must persist cancelled: true on the assistant turn",
  );
  assert.match(
    sendSource,
    /if \(cancelledByUser\) \{\s*\n\s*if \(!assistantText\.trim\(\)\) assistantText = "\(cancelled\)";\s*\n\s*result\.is_error = false;/,
    "/chat/send: a user cancel must never be recorded as a harness error (stream-json path)",
  );
  assert.match(
    sendSource,
    /if \(cancelledByUser\) \{\s*\n\s*if \(!assistantText\.trim\(\)\) assistantText = "\(cancelled\)";\s*\n\s*isError = false;/,
    "/chat/send: a user cancel must never be recorded as a harness error (openclaw path)",
  );

  // SSE heartbeats: a long tool run can stream nothing for minutes, and a
  // silent connection gets dropped by NATs/proxies and client idle timeouts
  // (the iOS app most of all). Both adapter paths must emit comment frames
  // — which every consumer skips (frames not starting with "data:") — and
  // clear the interval when the stream closes.
  assert.match(
    sendSource,
    /const SSE_HEARTBEAT = new TextEncoder\(\)\.encode\(": hb\\n\\n"\)/,
    "/chat/send: heartbeat is an SSE comment frame, invisible to data: parsers",
  );
  const heartbeatStarts = [...sendSource.matchAll(/const heartbeat = startSseHeartbeat\(controller,/g)];
  assert.equal(
    heartbeatStarts.length,
    2,
    "/chat/send: both adapter paths must start the SSE heartbeat",
  );
  const heartbeatClears = [
    ...sendSource.matchAll(/closed = true;\s*\n\s*clearInterval\(heartbeat\);/g),
  ];
  assert.equal(
    heartbeatClears.length,
    2,
    "/chat/send: both adapter paths must clear the heartbeat when the stream closes",
  );
}

{
  const sessionsListSource = readFileSync(
    path.join(apiRoot, "sessions", "list", "route.ts"),
    "utf8",
  );
  assert.match(
    sessionsListSource,
    /import \{ loadProjects, projectForRoot \} from "@\/lib\/cave-projects"/,
    "/sessions/list: session validation should consult the project registry",
  );
  assert.match(
    sessionsListSource,
    /function isKnownProjectOrValidDir\(projectRoot: string\): boolean \{[\s\S]*?projectForRoot\(projectRoot, projects\)[\s\S]*?isTrueProjectCwd\(projectRoot\)/,
    "/sessions/list: registered projects should pass validation before falling back to disk",
  );
  assert.match(
    sessionsListSource,
    /import \{ enrichSessionsWithGitContext \} from "@\/lib\/session-git-enrich"/,
    "/sessions/list: sessions should be enriched from local git context (async lib)",
  );
  assert.doesNotMatch(
    sessionsListSource,
    /execFileSync|execSync|spawnSync/,
    "/sessions/list: the polled list route must never run sync subprocesses on the event loop (cave-n37w)",
  );
  assert.match(
    sessionsListSource,
    /await enrichSessionsWithGitContext\(/,
    "/sessions/list: git enrichment should be awaited (async), not run synchronously",
  );
  assert.match(
    sessionsListSource,
    /const sessionsListCache = createSwrCache<SessionsListResult>\(/,
    "/sessions/list: repeated callers should share a stale-while-revalidate cached response",
  );
  assert.match(
    sessionsListSource,
    /canServeStale: \(result\) => result\.payload\.ok/,
    "/sessions/list: error payloads must never be served stale (no pinned 503s)",
  );
  assert.match(
    sessionsListSource,
    /SESSIONS_LIST_STALE_SERVE_MS = 30_000/,
    "/sessions/list: stale serve window covers the poll cadence so polls never block on recompute",
  );

  const swrCacheSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "swr-cache.ts"),
    "utf8",
  );
  assert.match(
    swrCacheSource,
    /const existing = inFlight\.get\(key\);\s*\n\s*if \(existing\) return existing;/,
    "swr-cache: concurrent callers should await one in-flight computation",
  );
  assert.match(
    swrCacheSource,
    /revalidate\(key, compute\)\.catch\(\(\) => undefined\);\s*\n\s*return entry\.value;/,
    "swr-cache: stale reads serve the cached value and revalidate in the background",
  );

  const sessionGitEnrichSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "session-git-enrich.ts"),
    "utf8",
  );
  assert.match(
    sessionGitEnrichSource,
    /promisify\(execFile\)/,
    "session-git-enrich: git must run through async execFile (no event-loop block)",
  );
  assert.doesNotMatch(
    sessionGitEnrichSource,
    /execFileSync|execSync|spawnSync/,
    "session-git-enrich: no sync subprocess fallbacks",
  );
  assert.match(
    sessionGitEnrichSource,
    /"branch", "--show-current"[\s\S]*"rev-parse", "--short", "HEAD"/,
    "session-git-enrich: git context should expose branch or detached head",
  );
  assert.match(
    sessionGitEnrichSource,
    /"rev-parse", "--show-toplevel"[\s\S]*"rev-parse", "--git-common-dir"/,
    "session-git-enrich: git context should detect worktree-backed roots",
  );
  assert.match(
    sessionGitEnrichSource,
    /"rev-parse", "--is-inside-work-tree"/,
    "session-git-enrich: git context should skip non-worktree roots before slower git probes",
  );
}

{
  const githubTasksSource = readFileSync(
    path.join(apiRoot, "github", "tasks", "route.ts"),
    "utf8",
  );
  assert.match(
    githubTasksSource,
    /if \(!endpoint\) \{[\s\S]*?return NextResponse\.json\(\{[\s\S]*?ok: false,[\s\S]*?tasks: \[\],[\s\S]*?\}\);/,
    "/github/tasks: missing optional task endpoint should be a quiet ok:false payload, not a browser-console 503",
  );
}

{
  const projectFileSource = readFileSync(
    path.join(apiRoot, "project-file", "route.ts"),
    "utf8",
  );
  const projectPathsSource = readFileSync(
    path.join(root, "src", "lib", "server", "project-paths.ts"),
    "utf8",
  );
  assert.match(
    projectPathsSource,
    /export function resolveAllowedProjectSubpath\(value: string\): \{ root: string; relativePath: string \} \| null \{[\s\S]*?relativeWithinRoot\(candidate, root\)[\s\S]*?return \{ root, relativePath \}/,
    "shared project path validation must expose safe root + relativePath parts for file reads",
  );
  assert.match(
    projectPathsSource,
    /export function resolveAllowedProjectPath\(value: string\): string \| null \{[\s\S]*?path\.join\(subpath\.root, subpath\.relativePath\)/,
    "shared project path validation must keep the existing absolute-path API contract",
  );
  assert.match(
    projectFileSource,
    /import \{ resolveAllowedProjectSubpath \} from "@\/lib\/server\/project-paths"/,
    "/project-file must use root + relativePath validation for file reads",
  );
  assert.match(
    projectFileSource,
    /const allowed = resolveAllowedProjectSubpath\(filePath\);[\s\S]*?if \(!allowed\)[\s\S]*?path not allowed[\s\S]*?const resolved = path\.join\(allowed\.root, allowed\.relativePath\);/,
    "/project-file must rebuild the read path from validated root + relativePath parts",
  );
  assert.match(
    projectFileSource,
    /const IMAGE_EXTENSIONS = new Map\(\[[\s\S]*?\["\.png", "image\/png"\][\s\S]*?\["\.webp", "image\/webp"\][\s\S]*?\["\.svg", "image\/svg\+xml"\]/,
    "/project-file: browser-supported visual formats should be previewable, not rejected as unsupported extensions",
  );
  assert.match(
    projectFileSource,
    /kind: "image"[\s\S]*?dataUrl: `data:\$\{imageMimeType\};base64,\$\{data\.toString\("base64"\)\}`[\s\S]*?mimeType: imageMimeType/,
    "/project-file: image responses must include a data URL and mime type for the Projects preview",
  );
  assert.match(
    projectFileSource,
    /const maxSize = imageMimeType \? MAX_IMAGE_SIZE : MAX_TEXT_SIZE;/,
    "/project-file: image previews should have their own bounded size cap instead of using the text-file cap",
  );
}

// The test:api npm script delegates to scripts/run-tests.mjs; assert this
// suite is listed in that runner's manifest so it actually runs in CI.
const runnerSource = readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");
assert.match(runnerSource, /api-contracts\.test\.ts/, "scripts/run-tests.mjs must list this API contract suite");

console.log(`api-contracts.test.ts: ${contracts.length} route contracts passed`);
