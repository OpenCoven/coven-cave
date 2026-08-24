// cave-mjotl: BEHAVIOURAL test for the X capability gate on
// GET /api/research/recommendations, driving the real exported handler and its
// production dependencies rather than the injectable route factory.
//
// The acceptance audit of #4816 (criterion 6, "familiar scoping of every read
// and write") found this route calling listSavedXSources(familiarId) with no
// capability check, so a familiar whose `xResearchEnabled` was false still got
// X-derived recommendations and X context counts back. Every /api/x/* handler
// gates on requireXCapability; this one X-derived read did not.
//
// The factory tests next door cover the contract with an injected capability
// check, which cannot see whether the production wiring supplies one at all —
// the same blind spot PR #4858 hit from the other direction, where a route
// source-text scan could not see a call that was never written. So this file
// exercises `GET` itself: real config, real X source store, real ranking.
//
// No network and no X credentials. The capability is resolved from persisted
// config, which is the whole point of the gate, and every durable path is
// redirected into a temp directory.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "research-recommendations-x-"));
const caveHome = path.join(root, "cave");
await mkdir(caveHome, { recursive: true });

process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = caveHome;
process.env.COVEN_X_SOURCES_DIR = path.join(root, "x-sources");
process.env.COVEN_X_CACHE_DIR = path.join(root, "x-cache");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");

const FAMILIAR_ID = "researcher";
const POST_ID = "1881";

/** The grant only exists server-side, in config.json — a request cannot assert it. */
async function writeXResearchGrant(granted: boolean): Promise<void> {
  await writeFile(
    path.join(caveHome, "config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: { xResearchEnabled: granted } } }),
    "utf8",
  );
}

await writeXResearchGrant(false);

const { GET } = await import("./recommendations/route.ts");
const { canonicalXPostUrl } = await import("@/lib/x-api");
const { upsertSavedXSource } = await import("@/lib/server/x-sources");

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const canonicalUrl = canonicalXPostUrl(POST_ID, "opencoven");
const { source } = await upsertSavedXSource({
  familiarId: FAMILIAR_ID,
  postId: POST_ID,
  canonicalUrl,
  originalUrl: canonicalUrl,
  note: "Retrieval benchmark discussion worth a mission",
  tags: [],
});

function recommendationsRequest(): Request {
  return new Request(
    `http://127.0.0.1:3000/api/research/recommendations?familiarId=${FAMILIAR_ID}`,
    { headers: { host: "127.0.0.1:3000" } },
  );
}

type ResponseBody = {
  ok: boolean;
  context: { xSources: number };
  recommendations: Array<{
    payload: { sourceId?: string };
    evidenceRefs: Array<{ id: string; label: string }>;
  }>;
};

async function read(): Promise<{ status: number; body: ResponseBody }> {
  const response = await GET(recommendationsRequest());
  return { status: response.status, body: (await response.json()) as ResponseBody };
}

test("a familiar without the X research capability gets no X-derived recommendations", async () => {
  const { status, body } = await read();

  assert.equal(status, 200, "the non-X portion of the route must keep serving");
  assert.equal(body.ok, true);
  assert.equal(body.context.xSources, 0, "no saved X source may enter the context");
  assert.deepEqual(
    body.recommendations
      .flatMap((recommendation) => recommendation.evidenceRefs)
      .filter((ref) => ref.id === `saved-link:${source.id}` || ref.label.includes("X Article")),
    [],
    "no recommendation may cite an X source the familiar is not allowed to read",
  );
  assert.deepEqual(
    body.recommendations.filter((recommendation) => recommendation.payload.sourceId === source.id),
    [],
  );
});

test("granting the X research capability restores the same familiar's X-derived recommendations", async () => {
  // Positive control: the saved source really is on disk and really is
  // rankable, so the suppression above is the capability gate and not an
  // unrelated read failure.
  await writeXResearchGrant(true);
  const { status, body } = await read();

  assert.equal(status, 200);
  assert.equal(body.context.xSources, 1);
  assert.deepEqual(
    body.recommendations
      .flatMap((recommendation) => recommendation.evidenceRefs)
      .map((ref) => ref.id),
    [`saved-link:${source.id}`],
  );
});

test("a malformed X grant fails closed rather than reading the X store", async () => {
  // The gate tests `=== true`, so a truthy non-boolean is not a grant.
  await writeFile(
    path.join(caveHome, "config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: { xResearchEnabled: "yes" } } }),
    "utf8",
  );
  const { status, body } = await read();

  assert.equal(status, 200);
  assert.equal(body.context.xSources, 0);
});

console.log("research recommendations x-capability test passed");
