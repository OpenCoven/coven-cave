// @ts-nocheck
// cave-cst0g: a brand-new conversation's origin is server-minted, never
// client-supplied. The chat surface (/api/chat/send) ignores body.origin, so a
// caller cannot label a new conversation as a hidden generation
// (canvas/journal/enhance) to suppress the knowledge vault or keep it out of
// the chat lists. Only the dedicated generation surface
// (/api/chat/generate/<origin>) mints a projectless origin, from its own path.
// Persisted conversations keep owning their provenance on resume.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = await mkdtemp(path.join(homedir(), "cave-origin-server-mint-"));
const caveHome = path.join(home, "cave");
const missingHermes = path.join(home, "bin", process.platform === "win32" ? "missing-hermes.exe" : "missing-hermes");

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
const { POST } = await import("./route.ts");
const { POST: generatePOST } = await import("../generate/[origin]/route.ts");

await saveConfig({ familiars: { ember: { harness: "hermes" } } });

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
      prompt: "hello",
      ...overrides,
    }),
  }));
}

function generate(origin, overrides = {}) {
  return generatePOST(
    new Request(`http://localhost/api/chat/generate/${origin}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "ember",
        prompt: "hello",
        ...overrides,
      }),
    }),
    { params: Promise.resolve({ origin }) },
  );
}

const GATED_MESSAGE = "Choose a project this familiar can access before starting chat.";
const HIDDEN_GENERATION_MESSAGE = "This hidden generation has no safe familiar workspace.";

// ── spoofed origin on the chat surface ──────────────────────────────────────
for (const spoofed of ["canvas", "journal", "enhance"]) {
  test(`/api/chat/send ignores a spoofed "${spoofed}" origin for a new conversation`, async () => {
    const response = await send({ origin: spoofed });
    assert.equal(response.status, 400, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.code, "project_root_required");
    // The request must be project-GATED like any ordinary chat — not admitted
    // into the auth-free projectless generation lane. Before cave-cst0g this
    // returned the hidden-generation refusal (or launched in the familiar
    // workspace when one existed).
    assert.equal(payload.error, GATED_MESSAGE);
  });
}

// ── the generation surface mints the origin from its path ──────────────────
for (const origin of ["canvas", "journal", "enhance"]) {
  test(`/api/chat/generate/${origin} mints the "${origin}" origin server-side`, async () => {
    const response = await generate(origin);
    assert.equal(response.status, 400, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.code, "project_root_required");
    // The minted origin admits the send into the projectless generation lane
    // (which then fails only because this fixture familiar has no workspace).
    assert.equal(payload.error, HIDDEN_GENERATION_MESSAGE);
  });
}

test("/api/chat/generate rejects an origin that is not a hidden generation", async () => {
  for (const bogus of ["chat", "bogus", "Board"]) {
    const response = await generate(bogus);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "unknown generation origin" });
  }
});

// ── persisted conversations keep owning their provenance ───────────────────
test("resume keeps the persisted origin — a spoofed body origin cannot relabel an existing conversation", async () => {
  const sessionId = "origin-mint-resume-session";
  const convDir = path.join(caveHome, "conversations");
  await mkdir(convDir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    path.join(convDir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      familiarId: "ember",
      harness: "hermes",
      // A typed/voice conversation: NOT a hidden generation.
      origin: "call",
      createdAt: now,
      updatedAt: now,
      turns: [],
    }),
  );

  const response = await send({ sessionId, origin: "canvas" });
  assert.equal(response.status, 400, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.code, "project_root_required");
  // The persisted "call" origin (non-projectless) wins over the spoofed
  // "canvas" claim: the request is gated like an ordinary conversation, never
  // relabeled into the hidden-generation lane.
  assert.equal(payload.error, GATED_MESSAGE);
});
