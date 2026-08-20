// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = await mkdtemp(path.join(homedir(), "cave-ios-first-turn-project-"));
const caveHome = path.join(home, "cave");
const projectRoot = path.join(home, "projects", "granted");
const deniedProjectRoot = path.join(home, "projects", "denied");
const missingHermes = path.join(home, "bin", process.platform === "win32" ? "missing-hermes.exe" : "missing-hermes");

await mkdir(projectRoot, { recursive: true });
await mkdir(deniedProjectRoot, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousHermesBin = process.env.HERMES_BIN;
const previousHermesApiUrl = process.env.HERMES_API_URL;
const previousHermesApiKey = process.env.HERMES_API_KEY;

process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = caveHome;
process.env.HERMES_BIN = missingHermes;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { saveConfig } = await import(new URL("../../../../lib/cave-config.ts", import.meta.url).href);
const { createProject } = await import(new URL("../../../../lib/cave-projects.ts", import.meta.url).href);
const { grantProjectToFamiliar } = await import(new URL("../../../../lib/project-permissions.ts", import.meta.url).href);
const { POST } = await import("./route.ts");

await saveConfig({ familiars: { ember: { harness: "hermes" } } });
const grantedProject = await createProject({ name: "Granted iOS fixture", root: projectRoot });
await createProject({ name: "Denied iOS fixture", root: deniedProjectRoot });
await grantProjectToFamiliar({
  familiarId: "ember",
  projectId: grantedProject.id,
  source: "human",
  access: "write",
});

after(async () => {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousHermesBin === undefined) delete process.env.HERMES_BIN;
  else process.env.HERMES_BIN = previousHermesBin;
  if (previousHermesApiUrl === undefined) delete process.env.HERMES_API_URL;
  else process.env.HERMES_API_URL = previousHermesApiUrl;
  if (previousHermesApiKey === undefined) delete process.env.HERMES_API_KEY;
  else process.env.HERMES_API_KEY = previousHermesApiKey;
  await rm(home, { recursive: true, force: true });
});

function send(overrides = {}) {
  return POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "ember",
      prompt: "Hello from iOS",
      ...overrides,
    }),
  }));
}

async function readSse(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, events };
}

test("first iOS turns without sessionId or projectRoot return project_root_required", async () => {
  const response = await send();
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "project_root_required",
    error: "Choose a project this familiar can access before starting chat.",
  });
});

test("a granted registered root passes authorization before runtime availability stops launch", async () => {
  const response = await send({ projectRoot });
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const { events } = await readSse(response);
  const error = events.find((event) => event.kind === "error");
  assert.equal(error?.code, "runtime_missing");
  assert.match(String(error?.message), /Hermes CLI not found on PATH/);
  assert.equal(
    events.some((event) => event.kind === "error" && String(event.code ?? "").startsWith("project_")),
    false,
    "a granted project root should clear the project launch boundary before runtime preflight fails",
  );
});

test("a registered but inaccessible root stays denied on the first iOS turn", async () => {
  const response = await send({ projectRoot: deniedProjectRoot });
  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "project_access_denied",
    error: "This familiar no longer has access to that project. Choose another project.",
  });
});
