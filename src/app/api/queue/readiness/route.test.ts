// @ts-nocheck
import assert from "node:assert/strict";

const previousToken = process.env.COVEN_CAVE_AUTH_TOKEN;
delete process.env.COVEN_CAVE_AUTH_TOKEN;

function request(body: unknown, host = "127.0.0.1") {
  return new Request("http://127.0.0.1/api/queue/readiness", {
    method: "POST",
    headers: { "content-type": "application/json", host },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

try {
  const { createQueueReadinessPostHandler } = await import("./route.ts");
  const projectA = { id: "project-a", name: "Project A", root: "/work/project-a" };
  let selected: typeof projectA | null = null;
  let readinessCalls = 0;

  const POST = createQueueReadinessPostHandler({
    queueProjectReadiness: async () => {
      readinessCalls += 1;
      return { ok: true, code: "ready", message: "Queue project is ready.", project: selected };
    },
    selectQueueProject: async (projectId: string) => {
      if (projectId !== projectA.id) return null;
      selected = projectA;
      return selected;
    },
  });

  assert.equal((await POST(request(null))).status, 400, "the handler rejects malformed JSON roots");
  assert.equal((await POST(request({ action: "select", projectId: projectA.id }, "example.test"))).status, 403, "selection is loopback-only");
  assert.equal((await POST(request({ action: "generate", projectId: projectA.id }))).status, 400, "there is no Generate action: GitHub Issues need no local workspace");
  assert.equal((await POST(request({ action: "select" }))).status, 400, "selection names a project");
  assert.equal((await POST(request({ action: "select", projectId: "x".repeat(201) }))).status, 400, "project ids are bounded");
  assert.equal((await POST(request({ action: "select", projectId: "missing" }))).status, 404, "an unknown project is not selected");
  assert.equal(readinessCalls, 0, "refused requests never probe readiness");

  const selectedResponse = await POST(request({ action: "select", projectId: ` ${projectA.id} ` }));
  assert.equal(selectedResponse.status, 200);
  const json = await selectedResponse.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.readiness.project, projectA, "selection answers with the readiness of the newly chosen project");
  assert.equal(readinessCalls, 1);

  const failing = createQueueReadinessPostHandler({
    queueProjectReadiness: async () => { throw new Error("unreachable"); },
    selectQueueProject: async () => { throw new Error("Cave could not save the Queue project selection."); },
  });
  const storage = await failing(request({ action: "select", projectId: projectA.id }));
  assert.equal(storage.status, 503, "a storage failure is reported, not swallowed");
  assert.match((await storage.json()).error, /could not save/);
} finally {
  if (previousToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = previousToken;
}

console.log("queue readiness route.test.ts: ok");
