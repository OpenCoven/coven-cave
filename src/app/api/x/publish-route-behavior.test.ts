// cave-uajyn: BEHAVIOURAL tests for /api/x/publish, driving the real route
// handlers against the real store.
//
// The property under test is the one the design document makes load-bearing:
// "the create-post route retrieves the frozen payload and never accepts
// replacement text with that request". Everything else in the publish path is
// arranged around it, so it is the assertion worth owning outright.
//
// It is asserted BEHAVIOURALLY — by sending replacement text and reading what
// reached X — rather than by scanning the route's source for a `body.text`
// read. A source scan proves only that today's spelling is absent; it says
// nothing about a `...body` spread, a helper that forwards the whole object,
// or a `text` parameter added to `publishXPublication` later. PR #4858 exists
// because a regex over route text cannot see a call that was never written.
//
// No network and no credentials: `fetch` is stubbed for the single outbound
// create-post, the token bundle is synthetic, and every durable path is
// redirected into a temp directory.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "x-publish-route-"));
const caveHome = path.join(root, "cave");
const publicationsDir = path.join(root, "x-publications");
await mkdir(caveHome, { recursive: true });
// The publish capability is resolved server-side from config; the client
// cannot assert it. `nova` holds it, `mute` deliberately does not.
await writeFile(
  path.join(caveHome, "config.json"),
  JSON.stringify({
    familiars: { nova: { xPublishEnabled: true }, mute: { xPublishEnabled: false } },
  }),
  "utf8",
);
process.env.COVEN_CAVE_HOME = caveHome;
process.env.COVEN_X_PUBLICATIONS_DIR = publicationsDir;
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");
// The development client-ID override the design documents. Without one the X
// client refuses to construct at all, which would mask every result under test
// behind `not-configured`. A public client ID field, never a secret.
process.env.COVEN_CAVE_X_CLIENT_ID = "synthetic-client-id";

const { POST } = await import("./publish/route.ts");
const { xCredentialService } = await import("@/lib/server/x-credentials");
const { listXPublications, upsertXPublicationDraft } = await import(
  "@/lib/server/x-publications"
);

const POST_ID = "1799999999999999999";
const realFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
});

/** What X was actually asked to post, in order. Empty means nothing went out. */
let sentToX: string[] = [];

beforeEach(async () => {
  sentToX = [];
  await rm(publicationsDir, { recursive: true, force: true });
  xCredentialService.replaceBundle({
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ["tweet.read", "tweet.write", "users.read"],
    account: { id: "42", username: "novaops", name: "Nova Ops" },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/tweets")) {
      throw new Error(`unexpected outbound request in a publish test: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
    sentToX.push(String(body.text));
    return new Response(
      JSON.stringify({ data: { id: POST_ID, text: body.text } }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
});

function publishRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1:3000/api/x/publish", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function draft(text: string, familiarId = "nova") {
  return upsertXPublicationDraft({ familiarId, text, accountId: "42" });
}

test("the route publishes the confirmed wording and ignores replacement text in the body", async () => {
  const { publication, confirmationToken } = await draft("The wording a person approved.");

  // A `text` field IS sent, carrying different wording, alongside a token that
  // is valid for the stored draft. If any layer between the route and X reads
  // it — a `body.text` read, a spread of the parsed body, a `text` parameter
  // grown on `publishXPublication` — the replacement is what X receives.
  const response = await POST(publishRequest({
    action: "publish",
    familiarId: "nova",
    publicationId: publication.id,
    confirmationToken,
    text: "Replacement wording nobody reviewed.",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(
    sentToX,
    ["The wording a person approved."],
    "X must receive the stored text, never the body's",
  );

  const stored = (await listXPublications("nova")).find((entry) => entry.id === publication.id);
  assert.equal(stored?.status, "published");
  assert.equal(stored?.text, "The wording a person approved.", "the record is not rewritten either");
  assert.equal(stored?.postId, POST_ID);
  assert.equal(stored?.canonicalUrl, `https://x.com/novaops/status/${POST_ID}`);
});

test("a token minted for the replacement wording does not unlock the stored draft", async () => {
  const approved = await draft("The wording a person approved.");
  // The other half of the same property. Above, the replacement rides along
  // with a valid token; here the caller holds a token that genuinely matches
  // their replacement text — just not this record. Neither combination may
  // reach X, and the second is the one that would work if the route ever
  // verified the token against the body instead of against the store.
  const other = await draft("Replacement wording nobody reviewed.");

  const response = await POST(publishRequest({
    action: "publish",
    familiarId: "nova",
    publicationId: approved.publication.id,
    confirmationToken: other.confirmationToken,
    text: "Replacement wording nobody reviewed.",
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(sentToX, [], "nothing reached X");
  const stored = (await listXPublications("nova")).find(
    (entry) => entry.id === approved.publication.id,
  );
  assert.equal(stored?.status, "draft", "the approved draft is untouched and still publishable");
});

test("an expired confirmation is refused with repairable copy, and sends nothing", async () => {
  const mintedAt = new Date(Date.now() - 11 * 60 * 1000);
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: "nova",
    text: "Reviewed eleven minutes ago.",
    accountId: "42",
    now: mintedAt,
  });

  const response = await POST(publishRequest({
    action: "publish",
    familiarId: "nova",
    publicationId: publication.id,
    confirmationToken,
  }));

  assert.equal(response.status, 400);
  const json = (await response.json()) as { ok: boolean; error: string };
  assert.equal(json.ok, false);
  // The refusal has to tell the person what to do about it. "Not confirmed"
  // sends them looking for a lost token; "expired … confirm again" names the
  // one action that repairs it.
  assert.match(json.error, /expired/i);
  assert.match(json.error, /confirm again/i);
  assert.deepEqual(sentToX, []);
  const stored = (await listXPublications("nova")).find((entry) => entry.id === publication.id);
  assert.equal(stored?.status, "draft");
});

test("a draft action cannot smuggle a post out: only `publish` ever reaches X", async () => {
  // `draft` is the only action that accepts text at all. It must remain a
  // purely local write — the confirmation step between drafting and publishing
  // is worth nothing if drafting itself can dispatch.
  const response = await POST(publishRequest({
    action: "draft",
    familiarId: "nova",
    text: "Drafting is local.",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(sentToX, []);
  const json = (await response.json()) as {
    publication: { id: string; status: string };
    confirmationToken: string;
  };
  assert.equal(json.publication.status, "draft");
  assert.match(json.confirmationToken, /^\d+\.[0-9a-f]{64}$/, "a stamped, keyed confirmation");
});

test("publishing without the familiar's grant sends nothing", async () => {
  const { publication, confirmationToken } = await draft("Ungranted.", "mute");

  const response = await POST(publishRequest({
    action: "publish",
    familiarId: "mute",
    publicationId: publication.id,
    confirmationToken,
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(sentToX, [], "the capability is checked before anything is dispatched");
  const stored = (await listXPublications("mute")).find((entry) => entry.id === publication.id);
  assert.equal(stored?.status, "draft");
});

test("two identical publish requests for one draft post exactly once", async () => {
  const { publication, confirmationToken } = await draft("Exactly once.");
  const body = {
    action: "publish",
    familiarId: "nova",
    publicationId: publication.id,
    confirmationToken,
  };

  const first = await POST(publishRequest(body));
  const second = await POST(publishRequest(body));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(sentToX, ["Exactly once."], "the second request sent nothing");
  const json = (await second.json()) as { alreadyPublished: boolean };
  assert.equal(json.alreadyPublished, true, "and says so rather than implying a second post");
});

test("changing the connected account after confirmation refuses the publish", async () => {
  const { publication, confirmationToken } = await draft("Approved for Nova Ops.");
  xCredentialService.replaceBundle({
    accessToken: "other-access-token",
    refreshToken: "other-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ["tweet.read", "tweet.write", "users.read"],
    account: { id: "99", username: "otherops", name: "Other Ops" },
  });

  const response = await POST(publishRequest({
    action: "publish",
    familiarId: "nova",
    publicationId: publication.id,
    confirmationToken,
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(sentToX, []);
  const stored = (await listXPublications("nova")).find((entry) => entry.id === publication.id);
  assert.equal(stored?.status, "draft");
});
