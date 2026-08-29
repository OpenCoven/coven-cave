// @ts-nocheck
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ConversationFile } from "../../lib/cave-conversations.ts";
import {
  buildFamiliarExecutionAnalytics,
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "../../lib/familiar-execution-analytics.ts";
import { backfillFamiliarExecutionAttempts } from "../../lib/server/familiar-execution-analytics-backfill.ts";
import {
  deterministicExecutionAttemptId,
  projectConversationExecutionAttempts,
} from "../../lib/server/familiar-execution-analytics-projection.ts";
import { serializeExecutionAttemptLedgerRecord } from "../../lib/server/familiar-execution-analytics-store.ts";
import {
  CLIENT_V1_AUTHENTICATED_PATHS,
  CLIENT_V1_PUBLIC_INGRESS,
  clientV1IngressKind,
} from "../../proxy-helpers.ts";
import { CLIENT_V1_CAPABILITIES } from "../../lib/server/client-v1/contract.ts";
import { CLIENT_V1_OPERATION_DEFINITIONS } from "../../lib/server/client-v1/operations.ts";
import { CLIENT_V1_READ_SCOPE } from "../../lib/server/client-v1/read-guard.ts";

const root = process.cwd();
const apiRoot = path.join(root, "src", "app", "api");

type RouteContract = {
  route: string;
  methods: string[];
  kind: "json" | "stream";
  readsJson?: boolean;
  invalidJson?: "guarded" | "fallback-empty" | "legacy-unhandled";
  optionalJsonBody?: boolean;
  pathGuard?: boolean;
  localOriginGuard?: boolean;
};

const contracts: RouteContract[] = [
  { route: "/access-groups", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/access-groups/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  // AFS routes expose a session's working tree, so every one is same-user
  // local IPC (specs/coven-agent-fs/DESIGN.md section 3).
  { route: "/afs", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/afs/[id]/commit", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/afs/[id]/diff", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/afs/[id]/timeline", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/app/build-info", methods: ["GET"], kind: "json" },
  { route: "/app/latest-release", methods: ["GET"], kind: "json" },
  { route: "/app/native-readiness", methods: ["GET"], kind: "json" },
  { route: "/asana/assigned", methods: ["GET"], kind: "json" },
  { route: "/asana/workspaces", methods: ["GET"], kind: "json" },
  { route: "/asana/pat", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/auto-mode/feedback", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/backup/export", methods: ["POST"], kind: "stream", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/backup/restore", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/backup/sync", methods: ["GET", "PUT"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/backup/sync/run", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/beads", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/beads/overview", methods: ["GET"], kind: "json", localOriginGuard: true, pathGuard: true },
  { route: "/beads/prs", methods: ["GET"], kind: "json", localOriginGuard: true, pathGuard: true },
  { route: "/board/[id]/chat", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]/enhance", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]/lifecycle", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board/enrich-steps", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/board/restore", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/board", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/canvas", methods: ["GET", "PUT", "POST", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/canvas/github-source", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/canvas/project-file", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/capabilities", methods: ["GET"], kind: "json" },
  { route: "/cave-home-migration", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/changes", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/chat/attachment", methods: ["GET"], kind: "stream", localOriginGuard: true, pathGuard: true },
  { route: "/chat/conversation", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/conversation/[id]", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/conversation/[id]/turns/[turnId]", methods: ["DELETE"], kind: "json" },
  { route: "/chat/model-state", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/broadcast", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/chat/rewrite", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/chat/search", methods: ["GET"], kind: "json" },
  { route: "/chat/generate/[origin]", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/chat/send", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/chat/stop", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/chat/stream", methods: ["GET"], kind: "stream" },
  { route: "/chat/stream/status", methods: ["GET"], kind: "json" },
  { route: "/chat/usage", methods: ["GET"], kind: "json" },
  // Client v1 deliberately carries no localOriginGuard, but for two different
  // reasons — and only the first is an exemption at all.
  //
  // Health and the pairing routes are the exemption: an external client must
  // be able to read its compatibility answer and walk the pairing exchange
  // before it holds a credential, which is the whole reason they exist. They
  // are the paths clientV1IngressKind (src/proxy-helpers.ts) classifies as
  // public, so proxy.ts applies the client-v1 ingress rules to them instead of
  // the ordinary gate. Health returns no user data and no paths, and is the one
  // route on this surface whose locality comes from that proxy branch alone.
  // All three pairing routes re-check the loopback stamp for themselves through
  // runtime.authenticator.isTrustedLoopback (client-v1/auth.ts) — the two POSTs
  // always did, and GET /client/v1/pairing/requests/[id] joined them in #4854,
  // because being the one dynamic-segmented route with no check of its own is
  // what made the escaped-path ingress hole answer there and nowhere else. Both
  // id-bearing routes also require the per-request pairing secret; the creating
  // POST mints that secret rather than checking one, and is bounded by the
  // pairing-create rate limit instead.
  //
  // The admin routes are NOT exempted. clientV1IngressKind returns null for
  // them, so they never take the client-v1 ingress branch's pass-through and
  // stay on the ordinary sidecar-token path in proxy.ts. Their locality is not
  // a by-product of that path: proxy.ts binds the family to a direct loopback
  // peer with a check of its own (#4843), refusing a forwarded caller with
  // `403 forbidden peer: client v1 admin requires direct loopback` before
  // falling through to that gate. requireClientV1Admin
  // (client-v1/admin-auth.ts) then adds the per-launch COVEN_CAVE_AUTH_TOKEN,
  // plus a same-origin Origin/Referer on mutations; it reads no loopback stamp
  // of its own, deliberately, because transport locality is not proof of the
  // administrator — the proxy check asks FROM WHERE, this one asks WHO.
  { route: "/client/v1/admin/credentials", methods: ["GET"], kind: "json" },
  { route: "/client/v1/admin/credentials/[id]", methods: ["DELETE"], kind: "json", readsJson: true },
  { route: "/client/v1/admin/pairing-requests", methods: ["GET"], kind: "json" },
  { route: "/client/v1/admin/pairing-requests/[id]/decision", methods: ["POST"], kind: "json", readsJson: true },
  // The client v1 operational state (cave-6rwq0): whether the discovery record
  // was published and whether the unverified-ownership waiver is in force —
  // the two degraded states that previously existed only on stderr. GET-only,
  // no body, same admin credential as the rest of the family.
  { route: "/client/v1/admin/status", methods: ["GET"], kind: "json" },
  // The Phase 2 canonical reads (cave-jfa9y). Every one is a GET with no body,
  // and every one authenticates its own bearer through requireScope — which is
  // load-bearing rather than routine, because these five paths are the first
  // entries in CLIENT_V1_AUTHENTICATED_PATHS and a listed path returns from
  // proxy() before the sidecar-token block ever runs. They also re-check the
  // loopback stamp for themselves, the way all three pairing routes do. That
  // began as cover for #4854, which #4855 has since closed at the proxy; it
  // stays because a route this list DEMOTES should not take its locality on
  // trust from the thing that demoted it.
  { route: "/client/v1/conversations", methods: ["GET"], kind: "json" },
  { route: "/client/v1/conversations/[id]", methods: ["GET"], kind: "json" },
  { route: "/client/v1/conversations/[id]/messages", methods: ["GET"], kind: "json" },
  { route: "/client/v1/familiars", methods: ["GET"], kind: "json" },
  { route: "/client/v1/health", methods: ["GET"], kind: "json" },
  { route: "/client/v1/pairing/requests", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/client/v1/pairing/requests/[id]", methods: ["GET"], kind: "json" },
  { route: "/client/v1/pairing/requests/[id]/exchange", methods: ["POST"], kind: "json" },
  { route: "/client/v1/projects", methods: ["GET"], kind: "json" },
  { route: "/codex-automations/[id]", methods: ["GET", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/codex-automations/[id]/run", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/codex-automations/[id]/runs", methods: ["GET"], kind: "json" },
  { route: "/codex-automations/[id]/runs/[runId]/log", methods: ["GET"], kind: "json" },
  { route: "/codex-automations", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/config", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/config/workspace-path", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/coven-memory", methods: ["GET", "POST"], kind: "json", localOriginGuard: true },
  { route: "/coven-memory/[id]", methods: ["GET", "POST"], kind: "json", localOriginGuard: true },
  { route: "/coven-memory/overview", methods: ["GET", "POST"], kind: "json", localOriginGuard: true },
  { route: "/coven/exec", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/daemon/capabilities", methods: ["GET"], kind: "json" },
  { route: "/daemon/connection", methods: ["GET"], kind: "json" },
  { route: "/daemon/diagnostics", methods: ["GET"], kind: "json" },
  { route: "/daemon/probe", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/daemon/start", methods: ["POST"], kind: "json" },
  { route: "/daemon/status", methods: ["GET"], kind: "json" },
  { route: "/daemon/travel/reconcile", methods: ["POST"], kind: "json" },
  { route: "/escalations/[id]", methods: ["PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/escalations", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  // DELETE added deliberately by cave-nv1dk.1: clearing an avatar is now a host
  // mutation, not a browser-local IndexedDB delete. Mirrors the sibling
  // /backdrop route, which already exposes GET/PUT/DELETE.
  { route: "/familiars/[id]/avatar", methods: ["GET", "POST", "DELETE"], kind: "stream", pathGuard: true },
  { route: "/familiars/[id]/backdrop", methods: ["GET", "PUT", "DELETE"], kind: "stream", localOriginGuard: true },
  { route: "/familiars/[id]/contract", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/dashboard", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/execution-analytics", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/reminders/[reminderId]/action", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/reminders/[reminderId]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/reminders", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/icon", methods: ["PUT"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/familiars/[id]/notes", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/self-report", methods: ["POST", "GET"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/familiars/[id]/self-reports/[sessionId]", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/self-reports/snapshots", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/self-reports", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]", methods: ["DELETE"], kind: "json", pathGuard: true },
  { route: "/familiars/removed", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/familiars", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/feedback/message", methods: ["POST", "GET"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/fs-browse", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true, localOriginGuard: true },
  { route: "/github/activity", methods: ["GET"], kind: "json" },
  { route: "/github/assigned", methods: ["GET"], kind: "json" },
  { route: "/github/checks", methods: ["GET"], kind: "json" },
  { route: "/github/repos", methods: ["GET"], kind: "json" },
  { route: "/github/subscriptions", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/github/user", methods: ["GET"], kind: "json" },
  { route: "/flows", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/flows/run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/flows/runs", methods: ["GET", "POST", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
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
  { route: "/github/diff", methods: ["GET"], kind: "json" },
  { route: "/github/dispatch", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/issue", methods: ["POST", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/item", methods: ["GET"], kind: "json" },
  { route: "/github/labels", methods: ["GET"], kind: "json" },
  { route: "/github/merge", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/reactions", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/rerun", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/resolve-thread", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/review", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/github/runs", methods: ["GET"], kind: "json" },
  { route: "/github/pat", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/github/tasks", methods: ["GET", "POST"], kind: "json" },
  { route: "/github/worktree", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grant-proposals/[id]", methods: ["PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grant-proposals", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/grimoire/graph", methods: ["GET"], kind: "json" },
  { route: "/harnesses", methods: ["GET"], kind: "json" },
  { route: "/hermes-profiles", methods: ["GET"], kind: "json" },
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
  { route: "/images/generate", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/journal", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/knowledge", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", pathGuard: true },
  { route: "/knowledge/collections", methods: ["GET"], kind: "json" },
  { route: "/knowledge/packs", methods: ["GET"], kind: "json" },
  { route: "/knowledge/packs/seed", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/launch", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/mobile-handoff", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/mobile-token/refresh", methods: ["POST"], kind: "json" },
  { route: "/mobile/coven-memory", methods: ["GET", "POST", "HEAD", "OPTIONS"], kind: "json" },
  { route: "/mobile/coven-memory/[id]", methods: ["GET", "POST", "HEAD", "OPTIONS"], kind: "json" },
  { route: "/mobile/coven-memory/overview", methods: ["GET", "POST", "HEAD", "OPTIONS"], kind: "json" },
  { route: "/mcp", methods: ["GET"], kind: "json" },
  { route: "/mcp/health", methods: ["GET"], kind: "json" },
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
  { route: "/milestones", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/omnigent/agents", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/omnigent/hosts", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/omnigent/sessions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/omnigent/status", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/onboarding/bootstrap", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/onboarding/install", methods: ["GET", "DELETE", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/onboarding/prerequisites", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/onboarding/setup", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/onboarding/codex-port-preflight", methods: ["POST"], kind: "json" },
  { route: "/onboarding/ssh-check", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/onboarding/status", methods: ["GET"], kind: "json" },
  { route: "/onboarding/update", methods: ["GET", "POST"], kind: "json" },
  { route: "/queue/readiness", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/opencoven/executions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/opencoven/submissions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/openclaw-agents", methods: ["GET"], kind: "json" },
  { route: "/opencoven-tools/status", methods: ["GET"], kind: "json" },
  { route: "/passkey/challenge", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/passkey/register", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/passkey/assert", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/passkey/enrolled", methods: ["GET", "DELETE"], kind: "json" },
  { route: "/preferences/backdrop", methods: ["GET", "PUT", "DELETE"], kind: "stream", localOriginGuard: true },
  { route: "/preferences", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/mobile-permissions", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/project-grants", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/project-file", methods: ["GET", "POST"], kind: "json", pathGuard: true, readsJson: true, invalidJson: "guarded" },
  { route: "/project-tree", methods: ["GET", "POST"], kind: "json", pathGuard: true, readsJson: true, invalidJson: "guarded" },
  { route: "/project/files", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/project/search", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/projects/[id]", methods: ["PUT", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/projects/icon", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/projects/seed", methods: ["POST"], kind: "json" },
  { route: "/projects", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/prompt/enhance", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/profile/avatar", methods: ["GET", "POST", "DELETE"], kind: "stream", readsJson: true, invalidJson: "guarded" },
  { route: "/profile", methods: ["GET", "PATCH"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/prompts", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/proposals", methods: ["GET"], kind: "json" },
  { route: "/proposals/[id]/approve", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", optionalJsonBody: true, localOriginGuard: true },
  { route: "/proposals/[id]/reject", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", optionalJsonBody: true, localOriginGuard: true },
  { route: "/roles", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/roles/crafts", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/roles/workflows", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/runtime-models/[runtime]", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/runtime-models/opencode", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/research/autoloop/document", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/research/autoloop/stream", methods: ["GET"], kind: "stream", localOriginGuard: true },
  { route: "/research/generations", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/research/generations/cancel", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/research/generations/infographic", methods: ["GET"], kind: "stream", localOriginGuard: true, pathGuard: true },
  { route: "/research/generations/media", methods: ["GET"], kind: "stream", localOriginGuard: true, pathGuard: true },
  // Mints the signed ticket the media route above consumes. No pathGuard: it
  // never resolves a filesystem path — it validates familiarId/id as opaque
  // ids and returns a URL, so there is no "path not allowed" 403 to preserve.
  { route: "/research/generations/media-ticket", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/research/generations/readiness", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/research/generations/render", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/research/links", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/research/missions/[id]/actions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions/[id]/files/[key]", methods: ["GET"], kind: "json", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions/[id]/schedule", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions/[id]", methods: ["GET"], kind: "json", localOriginGuard: true, pathGuard: true },
  { route: "/research/missions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
  { route: "/research/recommendations", methods: ["GET"], kind: "json", localOriginGuard: true },
  // No pathGuard: the id is validated against a strict arXiv shape and
  // interpolated into a hard-coded host, so there is no filesystem path to deny.
  { route: "/research/papers/pdf", methods: ["GET"], kind: "stream", localOriginGuard: true },
  { route: "/research/resources", methods: ["GET"], kind: "json", localOriginGuard: true },
  { route: "/research/resources/[id]", methods: ["GET", "POST", "DELETE"], kind: "json", localOriginGuard: true },
  { route: "/research/resources/search", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/retro-runs", methods: ["GET"], kind: "json" },
  { route: "/rss", methods: ["GET"], kind: "json" },
  { route: "/running-activity", methods: ["GET"], kind: "json" },
  { route: "/salem", methods: ["GET", "POST"], kind: "json", readsJson: true },
  { route: "/salem/pathfinder", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/salem/pathfinder/feedback", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/search", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/[id]/events", methods: ["GET"], kind: "json" },
  { route: "/sessions/[id]/input", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/[id]/kill", methods: ["POST"], kind: "json" },
  { route: "/sessions/[id]", methods: ["PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/sessions/list", methods: ["GET"], kind: "json" },
  { route: "/sessions/prune", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/sessions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/skills/file", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/skills/files", methods: ["GET"], kind: "json", pathGuard: true },
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
  { route: "/tailscale/devices", methods: ["GET"], kind: "json" },
  { route: "/threads/[id]", methods: ["GET"], kind: "json" },
  { route: "/threads/[id]/audit", methods: ["GET"], kind: "json" },
  { route: "/threads/[id]/strands", methods: ["GET"], kind: "json" },
  { route: "/travel/client", methods: ["GET", "PATCH"], kind: "json", readsJson: true },
  { route: "/vault", methods: ["GET", "POST", "PATCH", "DELETE"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/voice/credential-status", methods: ["GET"], kind: "json" },
  { route: "/voice/elevenlabs/catalog", methods: ["GET"], kind: "json" },
  { route: "/voice/elevenlabs/tts", methods: ["POST"], kind: "stream", readsJson: true },
  { route: "/voice/engines", methods: ["GET"], kind: "json" },
  { route: "/voice/engines/downloads", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/voice/engines/downloads/[jobId]", methods: ["GET"], kind: "json" },
  { route: "/voice/engines/models", methods: ["DELETE"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/voice/engines/whisper", methods: ["POST"], kind: "json", localOriginGuard: true },
  { route: "/voice/local/chat", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/voice/local/tts", methods: ["POST"], kind: "stream", readsJson: true, invalidJson: "guarded" },
  { route: "/voice/preview", methods: ["GET"], kind: "stream" },
  { route: "/voice/session", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/voice/transcript", methods: ["POST"], kind: "json", readsJson: true },
  { route: "/workflows/delete", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/dry-run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/workflows/layout", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/run", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/runs", methods: ["GET", "POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/workflows/save", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded" },
  { route: "/workflows/validate", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
  { route: "/workflows", methods: ["GET"], kind: "json" },
  { route: "/weaves", methods: ["GET"], kind: "json" },
  { route: "/weaves/[id]", methods: ["GET"], kind: "json" },
  // cave-lsj8u: the X route handlers, landed after their lib/ and
  // components/ halves. All five reject non-local requests; the four that
  // read a body go through readJsonBody, which returns its own guarded
  // response on malformed JSON.
  { route: "/x/connection", methods: ["GET", "DELETE"], kind: "json", localOriginGuard: true },
  { route: "/x/oauth/start", methods: ["POST", "DELETE"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/x/posts/lookup", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/x/posts/search", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/x/publish", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
  { route: "/x/sources", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true },
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
  const method = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
  const functions = [...source.matchAll(new RegExp(`export (?:async )?function (${method})\\b`, "g"))]
    .map((match) => match[1]);
  const constants = [...source.matchAll(new RegExp(`export const (${method})\\b`, "g"))]
    .map((match) => match[1]);
  const aliases = [...source.matchAll(new RegExp(`^\\s*[A-Za-z_$][\\w$]*\\s+as (${method})\\b`, "gm"))]
    .map((match) => match[1]);
  return [...functions, ...constants, ...aliases];
}

// Client v1 routes hand response construction to the shared envelope builders
// so every route answers in the same shape. Name those builders here rather
// than inlining `client-v1/responses.ts` into the route source: the builders
// are recognisable at the call site, the check does not depend on how a route
// spells the import specifier (`…/responses` vs `…/responses.ts`), and the
// readsJson / invalidJson assertions below keep reading the route itself
// instead of an unrelated module's text.
function usesJsonResponse(source: string): boolean {
  return /NextResponse\.json|Response\.json|new Response\(|clientV1(?:Success|Error|RateLimit)Response\s*\(|canonicalMemory(?:Json|ListResponse|OverviewResponse|DetailResponse)\s*\(/.test(source);
}

function effectiveRouteSource(file: string, source: string): string {
  const parts = [source];
  const reexport = source.match(/from\s+"(\.[^"]+\/route)";/);
  if (reexport) {
    const target = path.resolve(path.dirname(file), `${reexport[1]}.ts`);
    parts.push(readFileSync(target, "utf8"));
  }
  if (source.includes('from "@/lib/proposal-decision-body"')) {
    parts.push(readFileSync(path.join(apiRoot, "..", "..", "lib", "proposal-decision-body.ts"), "utf8"));
  }
  // cave-lsj8u: /x/oauth/start is only wiring — its handlers are built by
  // createXOAuthStartRouteHandlers so they can be tested without a server.
  // Inline that lib the same way, or the contract checks below read a file
  // with no response construction in it and conclude the route returns
  // nothing.
  if (source.includes('from "@/lib/server/x-oauth-start-route"')) {
    parts.push(readFileSync(path.join(apiRoot, "..", "..", "lib", "server", "x-oauth-start-route.ts"), "utf8"));
  }
  // The onboarding bootstrap route keeps GET and POST wiring in the App
  // Router module while its injectable handlers live beside the bootstrap
  // service. Inline that reviewed helper just like the OAuth route above.
  if (source.includes('from "@/lib/server/onboarding-bootstrap-route"')) {
    parts.push(readFileSync(path.join(apiRoot, "..", "..", "lib", "server", "onboarding-bootstrap-route.ts"), "utf8"));
  }
  if (source.includes('from "./install-service"')) {
    parts.push(readFileSync(path.join(path.dirname(file), "install-service.ts"), "utf8"));
  }
  return parts.join("\n");
}

// --- source text vs. source code ---------------------------------------------
//
// assert.match reads a route file as text, so any check spelled as "the source
// mentions X" is satisfied by a comment, a string, or a doc block that merely
// names X. For the credential assertions below that is not a nit: the whole
// point of those checks is to catch an author who MEANT to call the guard, and
// "meant to" is exactly what a `// TODO: … requireScope(…)` line looks like.
// Strip comments and literal text first so only code can satisfy them.
//
// A character scanner rather than a regex pair, because the naive
// `replace(/\/\/.*/g, "")` corrupts as much as it removes: a `//` inside a
// string literal, or a quote inside a regex character class such as /["']/,
// flips the state and eats real code up to the next delimiter. Anything the
// scanner cannot classify is dropped rather than kept, so the failure mode is a
// noisy assertion, not a silent pass.
function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote || ch === "\n") return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    // A ${…} substitution is dropped with the literal around it: real code has
    // no reason to call a credential guard from inside an interpolation, and
    // dropping it keeps the scanner from mistaking the closing brace for the
    // end of the template.
    if (ch === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === "\\") {
          i += 2;
          continue;
        }
        if (inner === "`") {
          i = skipTemplate(source, i);
          continue;
        }
        if (inner === '"' || inner === "'") {
          i = skipQuoted(source, i, inner);
          continue;
        }
        if (inner === "{") depth += 1;
        else if (inner === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function skipRegexLiteral(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i; // unterminated: it was division after all
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i + 1;
    i += 1;
  }
  return i;
}

// A `/` opens a regex literal only where a value may begin. Reading the last
// meaningful character already emitted is the standard way to tell that from
// division without a full parser.
const REGEX_MAY_FOLLOW = /(?:[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await))$/;

function executableSource(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i, ch);
      out += `${ch}${ch}`;
      continue;
    }
    if (ch === "`") {
      i = skipTemplate(source, i);
      out += "``";
      continue;
    }
    if (ch === "/" && REGEX_MAY_FOLLOW.test(out.trimEnd())) {
      i = skipRegexLiteral(source, i);
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const routeFiles = walkRoutes(apiRoot);
const actualRoutes = routeFiles.map(routeFromFile).sort();
const contractRoutes = contracts.map((contract) => contract.route).sort();

// Phase 0 forbade every /api/client/v1 route while the public contract was
// still an unserved module. Phase 1 ended that for the reviewed bootstrap and
// admin surface: health (a client cannot discover it is too old without an
// endpoint to ask), the pairing exchange, and the admin routes that approve
// and revoke credentials. Phase 2 adds the canonical reads the contract's
// capability list has been advertising since Phase 0 — familiars, projects,
// conversations, and a conversation's messages (cave-jfa9y). The gate is
// narrowed rather than dropped, because what it was really protecting against
// is client-v1 surface appearing faster than it is reviewed — so each new route
// has to be added here deliberately, not just by existing on disk.
assert.deepEqual(
  actualRoutes.filter((route) => route.startsWith("/client/v1")),
  [
    "/client/v1/admin/credentials",
    "/client/v1/admin/credentials/[id]",
    "/client/v1/admin/pairing-requests",
    "/client/v1/admin/pairing-requests/[id]/decision",
    "/client/v1/admin/status",
    "/client/v1/conversations",
    "/client/v1/conversations/[id]",
    "/client/v1/conversations/[id]/messages",
    "/client/v1/familiars",
    "/client/v1/health",
    "/client/v1/pairing/requests",
    "/client/v1/pairing/requests/[id]",
    "/client/v1/pairing/requests/[id]/exchange",
    "/client/v1/projects",
  ],
  "client-v1 must expose exactly the reviewed bootstrap, admin, and canonical-read routes",
);
assert.deepEqual(actualRoutes, contractRoutes, "every src/app/api route must have an API contract entry");

// --- client-v1 proxy pre-authorization (cave-4841) -------------------------
//
// clientV1IngressKind classifies a request BEFORE proxy() reaches the
// sidecar-token block, and a match makes proxy() return early: the mobile
// access gate is skipped and no bearer is checked. Everything after that point
// is the route's own responsibility. The two assertions below are the halves of
// that bargain, checked against what is actually on disk rather than against a
// list someone has to remember to prune.
//
// Concrete probe paths per route, because the ingress classifier takes a
// request pathname and the App Router directory speaks in [param] segments. A
// single [param] stands in as one literal segment, which is exactly what the
// single-segment [^/]+ patterns match.
//
// A [...catchAll] does NOT reduce to one segment, and treating it as if it did
// is how a route impersonates a reviewed public path:
// pairing/requests/[...rest] would probe as /api/client/v1/pairing/requests/
// probe-segment, match the single-segment public pattern, and be excused from
// the requireScope assertion below — while actually serving an unbounded tail
// that no one reviewed. So a catch-all is probed at every width it serves: the
// one-segment case it shares with [param], a two-segment case standing in for
// the whole tail, and — for the optional [[...catchAll]] — the parent path with
// the segment absent. The classification below then only excuses the route if
// EVERY one of those shapes is in the reviewed public set.
const PROBE_SEGMENT = "probe-segment";

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[");
}

function isCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[...") || segment.startsWith("[[...");
}

function isOptionalCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[[...");
}

function clientV1ProbePaths(route: string): string[] {
  const segments = route.slice(1).split("/");
  let paths: string[][] = [[]];
  for (const segment of segments) {
    const widths = !isDynamicSegment(segment)
      ? [[segment]]
      : isCatchAllSegment(segment)
        ? [
            ...(isOptionalCatchAllSegment(segment) ? [[] as string[]] : []),
            [PROBE_SEGMENT],
            [PROBE_SEGMENT, PROBE_SEGMENT],
          ]
        : [[PROBE_SEGMENT]];
    paths = paths.flatMap((prefix) => widths.map((width) => [...prefix, ...width]));
  }
  return paths.map((parts) => `/api/${parts.join("/")}`);
}

const clientV1Routes = routeFiles
  .map((file) => ({ file, route: routeFromFile(file) }))
  .filter(({ route }) => route.startsWith("/client/v1"));
const clientV1ProbeSurface = clientV1Routes.flatMap(({ route }) => clientV1ProbePaths(route));

// Half one: the list may not pre-authorize a path that nothing serves. Before
// cave-4841 it named thirteen Phase 2 paths and none of them had a route.ts, so
// the first Phase 2 handler to land would have been exempted from the sidecar
// token on the day it appeared — with its own requireScope call as the sole
// remaining layer, and no test anywhere insisting that call exist. Adding the
// entry is now part of adding the handler.
for (const pattern of CLIENT_V1_AUTHENTICATED_PATHS) {
  assert.ok(
    clientV1ProbeSurface.some((probe) => pattern.test(probe)),
    `${pattern} pre-authorizes client-v1 ingress but no src/app/api/client/v1 route.ts matches it`,
  );
}

// Half two: every client-v1 route that is not deliberately credential-free has
// to enforce a credential in its own source. That holds whether or not the path
// is pre-authorized above — the pre-authorization removes the sidecar token,
// and this check is what makes removing it survivable. Classification is read
// from the repo, not hardcoded: the admin family from the directory it lives
// in, the credential-free bootstrap surface from clientV1IngressKind itself.
// Growing the public set to dodge this check is not a quiet edit —
// CLIENT_V1_PUBLIC_PATHS only matches a path the allow-list assertion above
// already admits by name.
for (const { file, route } of clientV1Routes) {
  // executableSource, not the raw text: both assertions below are satisfied by
  // a call the route really makes, never by the NAME appearing in a comment or
  // a string. `// TODO(next): route this through requireScope(...)` on a route
  // with no credential check at all is exactly the accident this pair exists to
  // catch, and it read as a pass until cave-4841's review.
  const source = executableSource(effectiveRouteSource(file, readFileSync(file, "utf8")));
  if (route === "/client/v1/admin" || route.startsWith("/client/v1/admin/")) {
    // Admin routes never reach the client-v1 ingress branch at all
    // (clientV1IngressKind returns null for them), so they keep the ordinary
    // sidecar-token path and layer requireClientV1Admin on top. Different
    // credential, same obligation to name one.
    assert.match(
      source,
      /requireClientV1Admin\s*\(/,
      `${route} must call requireClientV1Admin`,
    );
    continue;
  }
  // EVERY shape the route serves has to be in the reviewed public set, not just
  // the narrowest one — a catch-all that happens to cover a reviewed
  // single-segment path still serves the rest of its tail credential-free.
  if (
    clientV1ProbePaths(route).every(
      (probe) => clientV1IngressKind(probe) === CLIENT_V1_PUBLIC_INGRESS,
    )
  ) {
    continue;
  }
  assert.match(
    source,
    /requireScope\s*\(/,
    `${route} is neither the admin family nor the reviewed credential-free bootstrap surface, so it must call requireScope`,
  );
  // Half three (cave-jfa9y): the same route must also meter the credential it
  // just accepted. Added with the first routes that actually call requireScope,
  // because until then consumeAuthenticated had no caller and the obligation
  // had nothing to attach to. A pre-authorized path has already given up the
  // sidecar-token gate, so an unmetered one lets a single valid bearer drive
  // the store, the daemon, and the transcript directory without bound — and
  // nothing else in the suite would notice, since an unmetered route passes
  // every functional test it has.
  //
  // Matched on the success-path charge specifically, and on that name ALONE —
  // there is no alternation here, deliberately. A future route that meters
  // against a different budget fails this assertion and has to widen it in
  // review rather than inherit an exemption by being written differently.
  assert.match(
    source,
    /consumeAuthenticated\s*\(/,
    `${route} calls requireScope but never charges the authenticated rate-limit budget`,
  );
}

// --- client-v1 capability truth (cave-8a0s2, #4869) ------------------------
//
// THE ASSERTION THIS BLOCK EXISTS FOR: an advertised capability must have a
// live owning route, and a live route must be advertised. Until #4869 the
// envelope declared `streaming` and `revisions` on every response and neither
// had a handler — nothing emitted a stream, nothing emitted or consumed a
// revision token — so an SDK helper spelled `client.supports("streaming")`
// would have returned a false operational claim and blocked freezing the
// SDK 0.1.0 contract.
//
// A hand-pruned list would only recreate that: the list had been hand-kept all
// along, and hand-keeping is what let it drift. So the declaration is derived
// from `CLIENT_V1_OPERATION_DEFINITIONS`, and this is the half that binds each
// of those records to a `route.ts` on disk. The two directions are separate
// assertions on purpose:
//
//   - a record whose route or method is gone fails, so a capability cannot
//     outlive the thing that served it;
//   - a shipped method with no record fails, so a route cannot land outside the
//     inventory and be invisible to a client reading it.
//
// Read from the App Router tree, never from a second list someone maintains —
// `clientV1Routes` above is the same walk the ingress assertions use.
{
  const routeMethodsOnDisk = new Map<string, Set<string>>();
  for (const { file, route } of clientV1Routes) {
    // The contract spells a dynamic segment `:id` and Next spells it `[id]`.
    // Normalize toward the contract, since that is the form a client sees.
    const contractPath = `/api${route}`.replace(/\[(\.{3})?([^\]]+)\]/gu, ":$2");
    routeMethodsOnDisk.set(
      contractPath,
      new Set(exportedMethods(readFileSync(file, "utf8"))),
    );
  }

  const declaredKeys = new Set<string>();
  for (const operation of CLIENT_V1_OPERATION_DEFINITIONS) {
    const methods = routeMethodsOnDisk.get(operation.path);
    assert.ok(
      methods !== undefined,
      `client-v1 operation ${operation.id} declares ${operation.path}, but no route.ts under src/app/api/client/v1 serves that path`,
    );
    assert.ok(
      methods.has(operation.method),
      `client-v1 operation ${operation.id} declares ${operation.method} ${operation.path}, but that route exports only [${[...methods].join(", ")}]`,
    );
    declaredKeys.add(`${operation.method} ${operation.path}`);

    // Ingress metadata may not widen access. `admin` is the sidecar-token
    // family, which clientV1IngressKind deliberately classifies null so it
    // keeps the ordinary gate; `public` is the reviewed credential-free
    // bootstrap set; `authenticated` is the demotion that trades the sidecar
    // token for the route's own requireScope. A record that mislabels any of
    // the three would publish an authority class the proxy does not enforce.
    const probePath = operation.path.replace(/:[^/]+/gu, "probe-segment");
    const expectedIngress =
      operation.ingress === "public"
        ? CLIENT_V1_PUBLIC_INGRESS
        : operation.ingress === "authenticated"
          ? "authenticated"
          : null;
    assert.equal(
      clientV1IngressKind(probePath),
      expectedIngress,
      `client-v1 operation ${operation.id} declares ingress "${operation.ingress}" but the proxy classifies ${probePath} as ${JSON.stringify(clientV1IngressKind(probePath))}`,
    );

    // And the credential the route really checks, read from its executable
    // source rather than its text, so a mention in a comment cannot satisfy it.
    const file = clientV1Routes.find(
      ({ route }) => `/api${route}`.replace(/\[(\.{3})?([^\]]+)\]/gu, ":$2") === operation.path,
    )?.file;
    assert.ok(file, `client-v1 operation ${operation.id} resolved no route file`);
    const routeSource = executableSource(effectiveRouteSource(file, readFileSync(file, "utf8")));
    if (operation.binding === "hpke-bound-v1") {
      assert.match(
        routeSource,
        /authority\.handle\s*\(/,
        `client-v1 operation ${operation.id} declares hpke-bound-v1 but its route never calls authority.handle`,
      );
    } else {
      assert.doesNotMatch(
        routeSource,
        /authority\.handle\s*\(/,
        `client-v1 operation ${operation.id} is not part of hpke-bound-v1`,
      );
    }
    if (operation.ingress === "admin") {
      assert.match(
        routeSource,
        /requireClientV1Admin\s*\(/,
        `client-v1 operation ${operation.id} is declared admin but its route never calls requireClientV1Admin`,
      );
    }
    if (operation.ingress === "authenticated") {
      assert.ok(
        operation.scope !== null,
        `client-v1 operation ${operation.id} is bearer-authenticated and must declare a scope`,
      );
      assert.match(
        routeSource,
        /requireScope\s*\(/,
        `client-v1 operation ${operation.id} is declared authenticated but its route never calls requireScope`,
      );
      // The DECLARED scope, not merely "some scope": a record claiming
      // `chat:read` against a route demanding `chat:write` would send every
      // reader of the inventory to a 403. Checked in two hops, because the
      // route names a constant rather than the literal — the source has to
      // name that constant, and the constant has to hold the declared value.
      assert.equal(
        operation.scope,
        CLIENT_V1_READ_SCOPE,
        `client-v1 operation ${operation.id} declares ${operation.scope}, but the canonical reads are guarded by ${CLIENT_V1_READ_SCOPE}`,
      );
      assert.match(
        routeSource,
        /scope:\s*CLIENT_V1_READ_SCOPE\b/,
        `client-v1 operation ${operation.id} declares scope ${operation.scope} but its route does not pass CLIENT_V1_READ_SCOPE to requireScope`,
      );
    }
  }

  // The converse. Every method a client-v1 route.ts exports has to be claimed
  // by exactly one operation record, so adding a route without inventory
  // metadata fails here rather than shipping a route no declaration mentions.
  const undeclared: string[] = [];
  for (const [contractPath, methods] of routeMethodsOnDisk) {
    for (const method of methods) {
      if (!declaredKeys.has(`${method} ${contractPath}`)) {
        undeclared.push(`${method} ${contractPath}`);
      }
    }
  }
  assert.deepEqual(
    undeclared,
    [],
    `client-v1 routes with no operation record in src/lib/server/client-v1/operations.ts: ${undeclared.join(", ")}`,
  );

  // And finally the capability list itself, checked against the routes rather
  // than against the registry it is derived from — this is the assertion that
  // fails when a capability with no owning route is advertised.
  const ownedFamilies = new Set<string>();
  for (const operation of CLIENT_V1_OPERATION_DEFINITIONS) {
    if (!routeMethodsOnDisk.get(operation.path)?.has(operation.method)) continue;
    for (const family of operation.families) ownedFamilies.add(family);
  }
  const unowned = (CLIENT_V1_CAPABILITIES as readonly string[]).filter(
    (capability) => !ownedFamilies.has(capability),
  );
  assert.deepEqual(
    unowned,
    [],
    `client-v1 advertises capabilities no live route can serve: ${unowned.join(", ")}`,
  );
  const undeclaredFamilies = [...ownedFamilies].filter(
    (family) => !(CLIENT_V1_CAPABILITIES as readonly string[]).includes(family),
  );
  assert.deepEqual(
    undeclaredFamilies,
    [],
    `client-v1 routes serve capability families the contract never advertises: ${undeclaredFamilies.join(", ")}`,
  );
}

for (const contract of contracts) {
  const file = path.join(apiRoot, ...contract.route.slice(1).split("/"), "route.ts");
  const source = readFileSync(file, "utf8");
  const effectiveSource = effectiveRouteSource(file, source);

  assert.deepEqual(exportedMethods(source), contract.methods, `${contract.route} HTTP method exports changed`);
  assert.equal(usesJsonResponse(effectiveSource), true, `${contract.route} must return an explicit Response/NextResponse`);

  const readsJson = contract.optionalJsonBody
    ? /await req\.text\(\)/.test(effectiveSource) && /JSON\.parse\(/.test(effectiveSource)
    : /req\.json\(\)|readJsonBody[<(]|parse[A-Za-z]*JsonBody[<(]/.test(effectiveSource);
  assert.equal(readsJson, contract.readsJson === true, `${contract.route} JSON body contract changed`);

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
  if (contract.optionalJsonBody) {
    assert.match(effectiveSource, /rawBody\.trim\(\)/, `${contract.route} must accept a missing request body`);
  }
  if (contract.pathGuard) {
    assert.match(source, /path not allowed|collection path not allowed/, `${contract.route} must preserve path-deny errors`);
    assert.match(source, /status:\s*403/, `${contract.route} path guard must preserve 403 response`);
  }
  if (contract.localOriginGuard) {
    // effectiveSource, not source — matching the readsJson/invalidJson checks
    // above. A route may apply the guard through an injected dependency
    // (/x/oauth/start passes rejectNonLocalRequest into
    // createXOAuthStartRouteHandlers, which calls it), and reading only the
    // route file would report that as a missing guard when it is present.
    // rejectResearchMediaRequest counts: it CALLS rejectNonLocalRequest first
    // and returns null whenever that passes, so it is a narrowing rather than a
    // weakening. It relaxes only when the host and the origin are both local
    // AND a signed media ticket validates — the carve-out exists because a
    // native <audio>/<video> element cannot go through patched fetch, so the
    // ticket proves the sidecar credential instead (#4634).
    assert.match(
      effectiveSource,
      /isLocalOrigin|rejectNonLocalRequest|rejectResearchMediaRequest/,
      `${contract.route} must preserve local-origin guard`,
    );
    if (effectiveSource.includes("rejectResearchMediaRequest")) {
      assert.match(
        effectiveSource,
        /await\s+rejectResearchMediaRequest\(\s*[A-Za-z_$][\w$]*\s*\)/,
        `${contract.route} must call the shared media guard`,
      );
      const guardSource = readFileSync(
        path.join(apiRoot, "..", "..", "lib", "server", "api-security.ts"),
        "utf8",
      );
      assert.match(
        guardSource,
        /export async function rejectResearchMediaRequest[\s\S]{0,200}rejectNonLocalRequest\(req\)/,
        "rejectResearchMediaRequest must still delegate to the local-origin guard",
      );
    } else if (effectiveSource.includes("rejectNonLocalRequest")) {
      assert.match(effectiveSource, /rejectNonLocalRequest\(req\)/, `${contract.route} must call the shared local-origin guard`);
    } else {
      assert.match(effectiveSource, /status:\s*403/, `${contract.route} local-origin guard must preserve 403 response`);
    }
  }
}

{
  const generationsSource = readFileSync(
    path.join(apiRoot, "research", "generations", "route.ts"),
    "utf8",
  );
  assert.match(
    generationsSource,
    /validateCreateResearchGenerationInput/,
    "research generations must keep input validation at the API boundary",
  );
  assert.match(
    generationsSource,
    /"media-not-ready" \? 409/,
    "research generations must expose media readiness as a conflict, never a fake queued record",
  );
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
    /media:\s*\{\s*\n\s*\.\.\.draft\.media,/,
    "/inbox/daily-summary should persist the generated media card (spread, so a backfill can stamp a truthful generatedAt over it)",
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
    /fetchMergedPrsForDay\(target\)\.catch\(/,
    "/inbox/daily-summary should gather merged PRs server-side for the TARGET day (today, or a backfilled past day), degrading to absent on failure",
  );
  assert.match(
    dailySummarySource,
    /body\.backfill !== true/,
    "/inbox/daily-summary must keep the midnight-rollover guard on the automatic path — only an explicit backfill may target another day",
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
// turn persists for resync. All three runtime paths (OpenClaw Gateway,
// OpenClaw CLI bridge, and the shared direct-runtime route) carry the guard.
{
  const sendSource = readFileSync(
    path.join(apiRoot, "chat", "send", "route.ts"),
    "utf8",
  );
  const sseSource = readFileSync(
    path.join(apiRoot, "chat", "send", "chat-send-sse.ts"),
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
    3,
    "/chat/send: all three dispatch paths must register with the stop registry",
  );
  assert.equal(
    [...sendSource.matchAll(/\{ runId: (?:args\.body|body)\.runId \}/g)].length,
    3,
    "/chat/send: every dispatch registration must identify the runId that can consume an early Stop",
  );
  assert.match(
    sendSource,
    /let stopChildOnLaunch = false;[\s\S]*if \(stopChildOnLaunch\)[\s\S]*const killChild = \(\) => \{\s*stopChildOnLaunch = true;/,
    "/chat/send: OpenClaw must carry an early registered Stop through its later child launch",
  );
  assert.match(
    sendSource,
    /const runAttempt = [\s\S]*if \(runHandle\.stopRequested\) return Promise\.resolve\(\);/,
    "/chat/send: shared direct dispatch must not launch after consuming an early Stop",
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
    /requestOrQueueChatStop\(runId\)/,
    "/chat/stop must accept a run-scoped Stop before async registration",
  );
  assert.match(
    stopSource,
    /stopped: outcome === "stopped"[\s\S]*queued: outcome === "queued"/,
    "/chat/stop must distinguish an immediate stop from a queued runId intent",
  );
  assert.match(
    stopSource,
    /requestChatStop\(sessionId!\)/,
    "/chat/stop must preserve session-only registry behavior without queueing it",
  );
  const guardedDiagnostics = [
    ...sendSource.matchAll(
      /(?:if \(cancelledByUser\) \{[\s\S]{0,200}?\} else if \(!assistantText\.trim\(\)(?: && !launchFailure)?\) \{|if \(!cancelledByUser && !assistantText\.trim\(\)\) \{)/g,
    ),
  ];
  assert.equal(
    guardedDiagnostics.length,
    2,
    "/chat/send: the empty-response error diagnostic must be skipped when the user cancelled",
  );
  assert.match(
    sendSource,
    /const reportLaunchFailure = \(err: NodeJS\.ErrnoException\) => \{[\s\S]*?const launchCode =[\s\S]*?launchFailure \?\?= \{[\s\S]*?code: sshRuntime \? err\.code \?\? "runtime_launch_failed" : launchCode,[\s\S]*?message: launchError,[\s\S]*?pushProgress\([\s\S]*?launchError,[\s\S]*?code: launchFailure\.code[\s\S]*?message: launchError/,
    "/chat/send: launch state, progress, and the post-spawn race event must reuse one normalized message and structured code",
  );
  assert.match(
    sendSource,
    /(?:let|const) localLaunchError(?:\: \{ code: string; message: string \})? = localRuntimeLaunchError\([\s\S]{0,200}?err\.code,[\s\S]{0,800}?const launchError = sshRuntime[\s\S]{0,600}?: localLaunchError\.message/,
    "/chat/send: every local post-spawn failure uses the shared runner-specific normalizer while SSH retains transport diagnostics",
  );
  assert.match(
    sendSource,
    /binding\.harness === "claude"[\s\S]*?evaluateCovenBackedRuntimeAvailability\(\{[\s\S]*?runner: "claude",[\s\S]*?covenCommand: launch\.command,[\s\S]*?env,[\s\S]*?unresolvedCovenWindowsShim:[\s\S]*?launch\.unresolvedWindowsShim === true/,
    "/chat/send: Claude preflight must verify both the Coven launcher and Claude in the exact later spawn environment",
  );
  assert.match(
    sendSource,
    /binding\.harness === "claude"[\s\S]*?claudeInnerLaunchMissing[\s\S]*?RUNTIME_AVAILABILITY_ERROR_CODES\.claude_missing/,
    "/chat/send: a post-preflight inner Claude disappearance remains a structured launch failure",
  );
  assert.doesNotMatch(
    sendSource,
    /(?:launchFailure \?\?=|pushProgress\(|kind: "error")[\s\S]{0,160}?message: err\.message/,
    "/chat/send: local runner state, progress, and SSE diagnostics never copy a raw OS launch error",
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
    3,
    "/chat/send: every adapter path must mark its persisted assistant turn as cancelled without changing the SSE protocol",
  );
  assert.match(
    sendSource,
    /if \(cancelledByUser\) \{\s*\n\s*if \(!assistantText\.trim\(\)\) assistantText = "\(cancelled\)";\s*\n\s*result\.is_error = false;/,
    "/chat/send: a user cancel must never be recorded as a harness error (stream-json path)",
  );
  assert.match(
    sendSource,
    /if \(cancelledByUser\) \{\s*\n\s*assistantText = "\(cancelled\)";\s*\n\s*isError = false;\s*\n\s*\} else if \(stdout\.trim\(\)\) \{/,
    "/chat/send: an explicit OpenClaw stop must take precedence over malformed or truncated bridge stdout",
  );

  // SSE heartbeats: a long tool run can stream nothing for minutes, and a
  // silent connection gets dropped by NATs/proxies and client idle timeouts
  // (the iOS app most of all). Both adapter paths must emit comment frames
  // — which every consumer skips (frames not starting with "data:") — and
  // clear the interval when the stream closes.
  assert.match(
    sseSource,
    /const HEARTBEAT = new TextEncoder\(\)\.encode\(": hb\\n\\n"\)/,
    "/chat/send: heartbeat is an SSE comment frame, invisible to data: parsers",
  );
  const heartbeatStarts = [...sendSource.matchAll(/const heartbeat = startChatSseHeartbeat\(controller,/g)];
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
  // The computation moved to @/lib/server/sessions-list (cave-9rwd.1) so the
  // Familiar dashboard read can reuse it without self-fetching this route.
  // These assertions follow the behaviour to its new home rather than being
  // relaxed: the route source is still checked for the things the route still
  // owns (the shared cache), and the compute source for the rest.
  const sessionsListSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "server", "sessions-list.ts"),
    "utf8",
  );
  const sessionsListRouteSource = readFileSync(
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
  // Checked on BOTH halves of the split, not just the one that happens to hold
  // the git calls today: the ban is on sync subprocesses anywhere on this
  // request path, and an extraction that moved the offending call into the
  // other file would otherwise pass.
  for (const [label, source] of [
    ["compute helper", sessionsListSource],
    ["route", sessionsListRouteSource],
  ] as const) {
    assert.doesNotMatch(
      source,
      /execFileSync|execSync|spawnSync/,
      `/sessions/list: the polled list ${label} must never run sync subprocesses on the event loop (cave-n37w)`,
    );
  }
  // Git enrichment is now reached through the `withGitContext` seam that lets a
  // read-only caller switch it off (cave-9rwd.1). The property is unchanged and
  // is asserted in both halves: the seam is async and returns the enrichment,
  // and every call site awaits the seam rather than firing it and moving on.
  assert.match(
    sessionsListSource,
    /const withGitContext = async \([\s\S]{0,160}enrichSessionsWithGitContext\(rows\)/,
    "/sessions/list: the git-enrichment seam is async and delegates to the async lib",
  );
  assert.equal(
    (sessionsListSource.match(/await withGitContext\(/g) || []).length,
    2,
    "/sessions/list: git enrichment is awaited on BOTH the healthy and degraded paths, not run synchronously or unawaited",
  );
  assert.equal(
    (sessionsListSource.match(/enrichSessionsWithGitContext\(/g) || []).length,
    1,
    "/sessions/list: the git enrichment has exactly one call site — the awaited seam — so no path can bypass the read-only opt-out",
  );
  assert.match(
    sessionsListRouteSource,
    /import \{\s*sessionsListCache\s*\} from "@\/lib\/server\/sessions-list-cache"/,
    "/sessions/list: repeated callers should share the invalidatable stale-while-revalidate cache (cave-53yx)",
  );
  assert.match(
    sessionsListRouteSource,
    /sessionsListCache\.get\(cacheKey, \(\) =>\s*computeSessionsList\(/,
    "/sessions/list: the route keeps cache ownership and delegates the cached compute to the shared helper",
  );
  // The extraction's whole point: one implementation, reachable without HTTP.
  assert.doesNotMatch(
    sessionsListSource,
    /sessionsListCache/,
    "/sessions/list: the reusable compute helper must not own the route's cache",
  );
  const sessionsListCacheSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "server", "sessions-list-cache.ts"),
    "utf8",
  );
  assert.match(
    sessionsListCacheSource,
    /export const sessionsListCache = createSwrCache<SessionsListResult>\(/,
    "sessions-list-cache: the shared cache instance is a stale-while-revalidate cache",
  );
  assert.match(
    sessionsListCacheSource,
    /canServeStale: \(result\) => result\.payload\.ok/,
    "sessions-list-cache: error payloads must never be served stale (no pinned 503s)",
  );
  assert.match(
    sessionsListCacheSource,
    /SESSIONS_LIST_STALE_SERVE_MS = 30_000/,
    "sessions-list-cache: stale serve window covers the poll cadence so polls never block on recompute",
  );
  assert.match(
    sessionsListCacheSource,
    /export function invalidateSessionsListCache\(\): void \{\s*\n\s*sessionsListCache\.clear\(\);/,
    "sessions-list-cache: mutation paths can bust every cached view (cave-53yx)",
  );

  const swrCacheSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "swr-cache.ts"),
    "utf8",
  );
  assert.match(
    swrCacheSource,
    /const existing = inFlight\.get\(key\)\?\.get\(version\);\s*\n\s*if \(existing\) return existing;/,
    "swr-cache: concurrent callers should dedupe on the current versioned in-flight request",
  );
  assert.match(
    swrCacheSource,
    /function revalidate\(key: string, compute: \(\) => Promise<T>, version = currentVersion\(key\)\): Promise<T> \{[\s\S]*?if \(versions\.get\(key\) === version\) entries\.set\(key, \{ computedAt: now\(\), value \}\);[\s\S]*?revalidate\(key, compute, version\)\.catch\(\(\) => undefined\);/,
    "swr-cache: stale reads should revalidate the current version, and older generations must not overwrite newer cache state",
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
  const beadsRouteSource = readFileSync(
    path.join(apiRoot, "beads", "route.ts"),
    "utf8",
  );
  const beadsOverviewSource = readFileSync(
    path.join(apiRoot, "..", "..", "lib", "server", "beads-delivery-source.ts"),
    "utf8",
  );
  assert.match(
    beadsOverviewSource,
    /export function invalidateBeadsDeliveryOverview\(repoRoot: string\): void \{\s*\n\s*overviewEpochs\.set\(repoRoot, readEpoch\(repoRoot\) \+ 1\);\s*\n\s*overviewCache\.delete\(repoRoot\);/,
    "beads-delivery-source: production invalidation should advance only the named canonical repo root and evict its cache entry",
  );
  assert.match(
    beadsRouteSource,
    /if \(!created\.ok\) \{[\s\S]*?return NextResponse\.json\([\s\S]*?\);\s*\}\s*invalidateBeadsDeliveryOverview\(root\.repoRoot\);/,
    "/beads create: invalidate the delivery overview only after a successful write",
  );
  assert.match(
    beadsRouteSource,
    /if \(!result\.ok\) \{[\s\S]*?return NextResponse\.json\([\s\S]*?\);\s*\}\s*invalidateBeadsDeliveryOverview\(root\.repoRoot\);/,
    "/beads mutations: invalidate the delivery overview only after a successful write",
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
  assert.match(
    githubTasksSource,
    /export async function POST\(\)[\s\S]*respondWithTasks\(true\)/,
    "/github/tasks: explicit refreshes bypass the fresh TTL entry",
  );
  assert.match(
    githubTasksSource,
    /forceGitHubTasksRefresh\(endpoint\)[\s\S]*getGitHubTasks\(endpoint\)/,
    "/github/tasks: both forced and automatic reads use the shared process cache",
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
    /export function resolveAllowedProjectPath\(value: string\): string \| null \{[\s\S]*?path\.join\(\/\* turbopackIgnore: true \*\/ subpath\.root, subpath\.relativePath\)/,
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

{
  const privateMarker = "PRIVATE-CONTENT-MUST-NOT-SURVIVE";
  const snapshot = normalizeExecutionAttemptSnapshot({
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId: "ea1_privacy",
    familiarId: "cody",
    sessionId: "session-private",
    turnId: "turn-private",
    attemptNumber: 1,
    execution: {
      kind: "assistant-response",
      origin: "chat",
      prompt: privateMarker,
      cwd: `/private/${privateMarker}`,
    },
    harness: { id: "claude", version: "1.2.3", binaryPath: privateMarker },
    models: {
      requested: { kind: "model", id: "anthropic/claude-sonnet" },
      forwarded: "claude-sonnet",
      confirmed: "claude-sonnet",
      response: privateMarker,
    },
    timing: {
      completedAt: "2026-08-18T09:00:00.000Z",
      durationMs: 1200,
      rawEvent: privateMarker,
    },
    usage: { inputTokens: 10, outputTokens: 20, rawPayload: privateMarker },
    costUsd: 0,
    outcome: { status: "error", error: privateMarker },
    tools: [{
      name: "shell",
      status: "error",
      durationMs: 100,
      input: privateMarker,
      output: privateMarker,
      path: `/private/${privateMarker}`,
    }],
    provenance: {
      source: "live",
      sourceSchema: "execution-attempt-v1",
      capturedAt: "2026-08-18T09:00:00.000Z",
      rawPayload: privateMarker,
    },
    coverage: { knownFields: ["tools"], arbitrary: privateMarker },
    prompt: privateMarker,
    response: privateMarker,
    errorText: privateMarker,
    path: `/private/${privateMarker}`,
  });
  assert.ok(snapshot, "metadata-only snapshots should accept the versioned allowlist");
  const serialized = serializeExecutionAttemptLedgerRecord(snapshot);
  assert.ok(serialized, "valid snapshots should serialize into a ledger record");
  assert.doesNotMatch(
    serialized,
    new RegExp(privateMarker),
    "snapshot normalization must discard prompt/response text, payloads, paths, and arbitrary errors",
  );
  assert.deepEqual(
    snapshot.tools,
    [{ name: "shell", status: "error", durationMs: 100 }],
    "tools retain only name, status, and duration",
  );
  assert.equal(snapshot.costUsd, 0, "a known zero cost remains distinct from missing cost");
}

{
  const conversation: ConversationFile = {
    sessionId: "session-deterministic",
    familiarId: "cody",
    harness: "claude-code",
    origin: "chat",
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T09:00:00.000Z",
    turns: [
      {
        id: "user-secret",
        role: "user",
        text: "private prompt",
        createdAt: "2026-08-18T08:00:00.000Z",
      },
      {
        id: "assistant-result",
        role: "assistant",
        text: "private response",
        reasoning: "private reasoning",
        createdAt: "2026-08-18T08:00:05.000Z",
        durationMs: 5000,
        usage: { inputTokens: 11, outputTokens: 7 },
        costUsd: 0.02,
        tools: [{
          id: "tool-1",
          name: "shell",
          input: "private tool input",
          output: "private tool output",
          status: "ok",
          durationMs: 800,
        }],
        responseMetadata: {
          familiarId: "cody",
          harness: "claude-code",
          model: "anthropic/claude-sonnet",
          runtime: "local",
          requestedModel: "anthropic/claude-sonnet",
          forwardedModel: "claude-sonnet",
          confirmedModel: "claude-sonnet",
          requestedControls: { reasoning: "high" },
          forwardedControls: { reasoning: "high" },
          appliedControls: { reasoning: "high" },
        },
      },
    ],
  };
  const first = projectConversationExecutionAttempts(conversation);
  const second = projectConversationExecutionAttempts(conversation);
  assert.deepEqual(first, second, "conversation projection must be deterministic");
  assert.equal(first.length, 1);
  assert.equal(
    first[0].attemptId,
    deterministicExecutionAttemptId({
      familiarId: "cody",
      sessionId: "session-deterministic",
      turnId: "assistant-result",
      attemptNumber: 1,
    }),
  );
  assert.deepEqual(
    first[0].harness,
    { id: "claude" },
    "historical projection canonicalizes the harness id without inventing a current version",
  );
  assert.equal("version" in (first[0].harness ?? {}), false);
  assert.doesNotMatch(JSON.stringify(first[0]), /private prompt|private response|private reasoning|private tool/);

  const deps = {
    listConversations: async () => [{
      sessionId: conversation.sessionId,
      familiarId: conversation.familiarId,
      harness: conversation.harness,
      updatedAt: conversation.updatedAt,
    }],
    loadConversation: async () => conversation,
  };
  const initial = await backfillFamiliarExecutionAttempts({
    familiarId: "cody",
    existing: [],
    dependencies: deps,
  });
  const replay = await backfillFamiliarExecutionAttempts({
    familiarId: "cody",
    existing: initial.attempts,
    dependencies: deps,
  });
  assert.equal(initial.toAppend.length, 1);
  assert.equal(replay.toAppend.length, 0, "replaying the same conversation must dedupe");
  assert.deepEqual(replay.attempts, initial.attempts);
}

{
  function attempt(
    attemptId: string,
    completedAt: string,
    extras: Record<string, unknown> = {},
  ): ExecutionAttemptSnapshotV1 {
    const value = normalizeExecutionAttemptSnapshot({
      schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
      attemptId,
      familiarId: "cody",
      sessionId: `session-${attemptId}`,
      turnId: `turn-${attemptId}`,
      attemptNumber: 1,
      execution: { kind: "assistant-response", origin: "chat" },
      timing: { completedAt },
      outcome: { status: "succeeded" },
      provenance: {
        source: "live",
        sourceSchema: "execution-attempt-v1",
        capturedAt: completedAt,
      },
      coverage: { knownFields: [] },
      ...extras,
    });
    assert.ok(value);
    return value;
  }

  const attempts = [
    attempt("recent-known", "2026-08-17T10:00:00.000Z", {
      harness: { id: "claude", version: "1.0.0" },
      models: { confirmed: "claude-sonnet" },
      timing: { completedAt: "2026-08-17T10:00:00.000Z", durationMs: 1000 },
      usage: { inputTokens: 10, outputTokens: 20 },
      costUsd: 0,
      tools: [],
    }),
    attempt("recent-missing", "2026-08-16T10:00:00.000Z"),
    attempt("old", "2026-06-01T10:00:00.000Z", {
      outcome: { status: "error" },
      timing: { completedAt: "2026-06-01T10:00:00.000Z", durationMs: 3000 },
    }),
  ];
  const analytics = buildFamiliarExecutionAnalytics({
    familiarId: "cody",
    attempts,
    now: new Date("2026-08-18T10:00:00.000Z"),
    recentLimit: 1,
  });
  assert.equal(analytics.windows["7d"].attempts, 2);
  assert.equal(analytics.windows.all.attempts, 3);
  assert.deepEqual(
    analytics.windows.all.coverage.duration,
    { known: 2, total: 3, ratio: 2 / 3 },
  );
  assert.deepEqual(
    analytics.windows.all.coverage.cost,
    { known: 1, total: 3, ratio: 1 / 3 },
  );
  assert.equal(analytics.windows.all.costUsd, 0);
  assert.deepEqual(
    analytics.windows.all.coverage.harnessVersion,
    { known: 1, total: 3, ratio: 1 / 3 },
  );
  assert.equal(analytics.recentAttempts.length, 1, "recent attempts are bounded");
  assert.equal(
    "cacheReadTokens" in analytics.recentAttempts[0],
    false,
    "an unknown recent-attempt metric remains absent",
  );
  assert.deepEqual(
    Object.keys(analytics).sort(),
    ["backfill", "generatedAt", "recentAttempts", "windows"],
    "the analytics domain object contains only the response contract",
  );
}

{
  const routeSource = readFileSync(
    path.join(apiRoot, "familiars", "[id]", "execution-analytics", "route.ts"),
    "utf8",
  );
  const source = readFileSync(
    path.join(root, "src", "lib", "server", "familiar-execution-analytics-source.ts"),
    "utf8",
  );
  const projection = readFileSync(
    path.join(root, "src", "lib", "server", "familiar-execution-analytics-projection.ts"),
    "utf8",
  );
  assert.match(
    routeSource,
    /if \(!isValidFamiliarId\(id\)\)[\s\S]*?"path not allowed"[\s\S]*?status: 403/,
    "/familiars/[id]/execution-analytics validates the familiar id before storage access",
  );
  assert.match(
    routeSource,
    /Math\.max\(0, Math\.min\(100, parsed\)\)/,
    "/familiars/[id]/execution-analytics bounds recent attempts",
  );
  assert.match(
    routeSource,
    /__setFamiliarExecutionAnalyticsSourceForTests/,
    "/familiars/[id]/execution-analytics exposes the established route test override",
  );
  assert.match(
    routeSource,
    /analytics: \{\s*generatedAt: analytics\.generatedAt,\s*windows: analytics\.windows,\s*recentAttempts: analytics\.recentAttempts,\s*backfill: analytics\.backfill,\s*\}/,
    "/familiars/[id]/execution-analytics returns the exact public analytics shape",
  );
  assert.match(
    source,
    /listConversations[\s\S]*loadConversation[\s\S]*backfillFamiliarExecutionAttempts/,
    "analytics source backfills from Cave-owned conversation files",
  );
  assert.match(
    source,
    /appendAttempts\(args\.familiarId, backfill\.toAppend\)[\s\S]*?\.catch\(\(\) => 0\)/,
    "derived ledger persistence is best-effort",
  );
  assert.doesNotMatch(
    projection,
    /turn\.text|turn\.reasoning|tool\.input|tool\.output|conversation\.runtime|conversation\.branch|conversation\.prUrl/,
    "conversation projection must not copy content, tool payloads, paths, or PR data",
  );
}

// The test:api npm script delegates to scripts/run-tests.mjs; assert this
// suite is listed in that runner's manifest so it actually runs in CI.
const runnerSource = readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");
assert.match(runnerSource, /api-contracts\.test\.ts/, "scripts/run-tests.mjs must list this API contract suite");
assert.match(
  runnerSource,
  /src\/lib\/server\/client-v1\/contract\.test\.ts/,
  "scripts/run-tests.mjs must list the public client v1 contract suite",
);
assert.match(
  runnerSource,
  /scripts\/export-client-v1-contract\.test\.mjs/,
  "scripts/run-tests.mjs must list the public client v1 exporter suite",
);
assert.match(
  runnerSource,
  /SUITE_PREFLIGHTS[\s\S]*api:\s*\[[\s\S]*\["scripts\/export-client-v1-contract\.mjs", "--check"\]/,
  "scripts/run-tests.mjs must read-only check the public client v1 contract fixture before API tests",
);

console.log(`api-contracts.test.ts: ${contracts.length} route contracts passed`);
