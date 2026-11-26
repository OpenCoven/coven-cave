// @ts-nocheck
// Behavioural tests for POST /api/board/[id]/chat against a daemon double on
// a scratch socket (#6562). The source contracts in route.test.ts pin the
// route's shape; these drive the real route, board, project registry and
// grants, and record every request the "daemon" receives.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// macOS caps a Unix socket path near 104 bytes; keep the fixture root short.
const base = fs.realpathSync(await mkdtemp(path.join(tmpdir(), "cbc-")));
const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};
process.env.COVEN_HOME = path.join(base, "coven");
process.env.COVEN_CAVE_HOME = path.join(base, "cave");
process.env.COVEN_SOCKET = path.join(base, "d.sock");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(base, "projects.json");
fs.mkdirSync(process.env.COVEN_HOME, { recursive: true });
fs.mkdirSync(process.env.COVEN_CAVE_HOME, { recursive: true });

// Registering a project asks the OS to confirm the folder; approve it here.
// Production has no bypass switch (see route-pin.integration.test.ts).
const nativeMock = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/native-folder-authentication.ts")) {
      return { format: "module", shortCircuit: true, source: "export async function authenticateProjectFolder() { return true; }" };
    }
    return nextLoad(url, context);
  },
});

/** A programmable daemon: `handle` answers, `requests` records. */
const daemon = {
  server: null,
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  handle: (_req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: "not_found", message: "no route" } }));
  },
  async start() {
    await rm(process.env.COVEN_SOCKET, { force: true });
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        this.requests.push({ method: req.method, url: req.url, body });
        res.setHeader("content-type", "application/json");
        this.handle(req, res, body);
      });
    });
    await new Promise((resolve) => this.server.listen(process.env.COVEN_SOCKET, resolve));
  },
  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections?.();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    await rm(process.env.COVEN_SOCKET, { force: true });
  },
  posts() {
    return this.requests.filter((entry) => entry.method === "POST" && entry.url === "/api/v1/sessions");
  },
};

try {
  const { POST: registerProject } = await import("@/app/api/projects/route");
  const { POST: startTaskChat } = await import("./route.ts");
  const board = await import("@/lib/cave-board");
  const { loadProjects } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { saveConversation } = await import("@/lib/cave-conversations");
  const { resetFirstPromptClaimsForTest } = await import("@/lib/server/task-chat-reuse");

  const request = (url, body) =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify(body),
    });
  const start = async (cardId, body = {}) => {
    const res = await startTaskChat(request(`http://localhost/api/board/${cardId}/chat`, body), {
      params: Promise.resolve({ id: cardId }),
    });
    return { status: res.status, json: await res.json() };
  };
  const cardById = async (id) => (await board.loadBoard()).cards.find((card) => card.id === id);

  // One confirmed, granted project, so every launch passes the folder gate.
  const root = path.join(base, "app");
  await mkdir(root);
  const registered = await registerProject(request("http://localhost/api/projects", { name: "App", root }));
  assert.equal(registered.status, 201, JSON.stringify(await registered.clone().json()));
  const project = (await registered.json()).project;
  await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "write" });
  const newTask = (title) => board.createCard({ title, familiarId: "nova", projectId: project.id });

  await test("socket missing: the POST provably never landed, so a trusted runtime reserves native Chat", async () => {
    await daemon.stop();
    const task = await newTask("Daemon down");
    const { status, json } = await start(task.id);
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.bridge, "native-chat");
    assert.equal(json.reused, false);
    assert.match(json.initialPrompt, /Daemon down/);
    const stored = await cardById(task.id);
    assert.equal(stored.sessionId, json.sessionId, "the reservation is on the card");
    assert.equal(stored.lifecycle, "queued", "a native task dispatches when its first prompt lands, not at reservation");

    assert.equal(stored.nativeSessionId, json.sessionId, "the route marks the session as Cave's own");

    // Reopened right away: the work view that started it may still be
    // sending, so no second view gets the prompt.
    const quick = await start(task.id);
    assert.equal(quick.json.reused, true);
    assert.equal(quick.json.initialPrompt, undefined, "a just-handed-out prompt is never handed out twice");

    // Later, with nothing sent, the prompt comes back, without asking the daemon.
    resetFirstPromptClaimsForTest();
    daemon.requests = [];
    const reopened = await start(task.id);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.reused, true);
    assert.equal(reopened.json.bridge, "native-chat");
    assert.equal(reopened.json.sessionId, json.sessionId);
    assert.equal(reopened.json.initialPrompt, json.initialPrompt, "the same first prompt comes back");
    assert.equal(reopened.json.projectRoot, fs.realpathSync.native(root));
    assert.equal(daemon.requests.length, 0, "reopening never starts or probes a daemon session");
    const again = await start(task.id);
    assert.equal(again.json.initialPrompt, undefined, "and only to one view");
    resetFirstPromptClaimsForTest();

    // Once the first prompt has landed, reopening never sends it again.
    await saveConversation({
      sessionId: json.sessionId,
      familiarId: "nova",
      harness: "claude",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [{ id: "u1", role: "user", text: json.initialPrompt, createdAt: new Date().toISOString(), parentId: null }],
      activeLeafId: "u1",
    });
    const sent = await start(task.id);
    assert.equal(sent.json.reused, true);
    assert.equal(sent.json.initialPrompt, undefined);
    assert.equal(sent.json.bridge, undefined);
    await daemon.stop();
  });

  await test("daemon timeout: the session may exist, so nothing is resent or reserved", async () => {
    daemon.requests = [];
    daemon.handle = () => { /* never answers */ };
    await daemon.start();
    const task = await newTask("Daemon slow");
    const { status, json } = await start(task.id);
    assert.equal(status, 502, JSON.stringify(json));
    assert.equal(daemon.posts().length, 1, "the create is sent exactly once");
    const stored = await cardById(task.id);
    assert.equal(stored.sessionId, null, "no native fallback after a timeout");
    assert.equal(stored.lifecycle, "queued");
    await daemon.stop();
  });

  await test("a daemon session dispatches a ready task, and reopening it carries no prompt", async () => {
    daemon.requests = [];
    daemon.handle = (req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/sessions") {
        res.end(JSON.stringify({ id: "d-1", status: "running" }));
        return;
      }
      if (req.method === "GET" && req.url === "/api/v1/sessions/d-1") {
        res.end(JSON.stringify({ id: "d-1", status: "running", created_at: "2026-11-25T00:00:00Z", updated_at: "2026-11-25T00:00:00Z" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "not_found" } }));
    };
    await daemon.start();
    const task = await newTask("Daemon up");
    const { status, json } = await start(task.id);
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.sessionId, "d-1");
    assert.equal(json.bridge, undefined);
    assert.equal(daemon.posts().length, 1);
    assert.match(daemon.posts()[0].body.prompt, /Daemon up/, "the daemon starts with the task prompt");
    assert.equal((await cardById(task.id)).lifecycle, "dispatched");

    const reopened = await start(task.id);
    assert.equal(reopened.json.reused, true);
    assert.equal(reopened.json.initialPrompt, undefined, "a daemon session already has its prompt");
    assert.equal(daemon.posts().length, 1, "reopening never creates another session");
    assert.equal((await cardById(task.id)).nativeSessionId, undefined, "a daemon session is never marked native");

    // The daemon later prunes the session. Its prompt was sent, so a reopen
    // must still not hand it back to native Chat.
    resetFirstPromptClaimsForTest();
    daemon.handle = (req, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "session_not_found", message: "Session was not found." } }));
    };
    const pruned = await start(task.id);
    assert.equal(pruned.json.reused, true);
    assert.equal(pruned.json.initialPrompt, undefined, "a pruned daemon session never re-runs the task natively");
    assert.equal(pruned.json.bridge, undefined);
    await daemon.stop();
  });

  await test("two concurrent starts reserve one native session, not two", async () => {
    await daemon.stop();
    const task = await newTask("Double press, daemon down");
    const [first, second] = await Promise.all([start(task.id), start(task.id)]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(first.json.sessionId, second.json.sessionId, "both presses land on one session");
    assert.deepEqual([first.json.reused, second.json.reused].sort(), [false, true]);
    assert.equal((await cardById(task.id)).sessionId, first.json.sessionId);
  });

  await test("two concurrent starts create one daemon session, not two", async () => {
    daemon.requests = [];
    let created = 0;
    daemon.handle = (req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/sessions") {
        created += 1;
        const id = `d-race-${created}`;
        setTimeout(() => res.end(JSON.stringify({ id, status: "running" })), 150);
        return;
      }
      const match = /^\/api\/v1\/sessions\/(d-race-\d+)$/.exec(req.url);
      if (req.method === "GET" && match) {
        res.end(JSON.stringify({ id: match[1], status: "running", created_at: "2026-11-25T00:00:00Z", updated_at: "2026-11-25T00:00:00Z" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "not_found" } }));
    };
    await daemon.start();
    const task = await newTask("Double press, daemon up");
    const [first, second] = await Promise.all([start(task.id), start(task.id)]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(daemon.posts().length, 1, "the second press waits and reuses instead of creating another session");
    assert.equal(first.json.sessionId, "d-race-1");
    assert.equal(second.json.sessionId, "d-race-1");
    assert.equal((await cardById(task.id)).sessionId, "d-race-1", "no orphaned session replaced the first");
    await daemon.stop();
  });

  await test("an unconfirmed folder is refused and recorded on the task once", async () => {
    const legacyRoot = path.join(base, "legacy");
    await mkdir(legacyRoot);
    // A record from before folder pinning: registered, granted, never confirmed.
    const projects = JSON.parse(fs.readFileSync(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"));
    const list = Array.isArray(projects) ? projects : projects.projects;
    list.push({ ...list[0], id: "legacy-project", name: "Legacy", root: legacyRoot, rootRealpath: undefined });
    await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify(projects));
    assert.ok((await loadProjects()).some((entry) => entry.id === "legacy-project"));
    await grantProjectToFamiliar({ familiarId: "nova", projectId: "legacy-project", source: "human", access: "write" });
    const task = await board.createCard({ title: "Unconfirmed", familiarId: "nova", projectId: "legacy-project" });

    daemon.requests = [];
    const first = await start(task.id);
    assert.equal(first.status, 409, JSON.stringify(first.json));
    assert.equal(first.json.code, "project_root_unconfirmed");
    assert.equal(first.json.card?.id, task.id, "the refusal returns the card it recorded on");
    const second = await start(task.id);
    assert.equal(second.status, 409);
    const blockers = (await cardById(task.id)).dependencies.filter((dependency) => dependency.ref === "project-folder:legacy-project");
    assert.equal(blockers.length, 1, "a repeat refusal doesn't add another blocker");
    assert.equal(blockers[0].state, "unresolved");
    assert.equal(blockers[0].origin, "system");
    assert.equal((await cardById(task.id)).sessionId, null, "nothing is reserved for a refused folder");
    assert.equal(daemon.requests.length, 0, "a refused folder never reaches the daemon");
  });
} finally {
  await daemon.stop().catch(() => {});
  nativeMock.deregister();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(base, { recursive: true, force: true });
}
