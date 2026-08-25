import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { XApiError } from "../x-api.ts";

const root = await mkdtemp(path.join(process.cwd(), ".x-publications-test-"));
const publicationsDir = path.join(root, "publications");
const originalDir = process.env.COVEN_X_PUBLICATIONS_DIR;
process.env.COVEN_X_PUBLICATIONS_DIR = publicationsDir;

const {
  listXPublications,
  publishXPublication,
  resolveXPublication,
  upsertXPublicationDraft,
} = await import("./x-publications.ts");

const FAMILIAR = "nova";
const OTHER_FAMILIAR = "cody";
const POST_ID = "1799999999999999999";

after(async () => {
  if (originalDir === undefined) delete process.env.COVEN_X_PUBLICATIONS_DIR;
  else process.env.COVEN_X_PUBLICATIONS_DIR = originalDir;
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(publicationsDir, { recursive: true, force: true });
});

/** A send that succeeds, recording every text it was handed. */
function recordingSend(sent: string[], id = POST_ID) {
  return {
    send: async (text: string) => {
      sent.push(text);
      return { id };
    },
    accountUsername: () => "novaops",
  };
}

/** A send that fails the way an interrupted write does: outcome unknown. */
function ambiguousSend(attempts: string[]) {
  return {
    send: async (text: string): Promise<{ id: string }> => {
      attempts.push(text);
      throw new XApiError("ambiguous-write", "X post delivery is uncertain", { dispatched: true });
    },
    accountUsername: () => "novaops",
  };
}

/** A send that fails definitely: X received the request and refused it. */
function refusedSend(attempts: string[]) {
  return {
    send: async (text: string): Promise<{ id: string }> => {
      attempts.push(text);
      throw new XApiError("invalid-request", "X refused the post", { status: 400 });
    },
    accountUsername: () => "novaops",
  };
}

async function draft(text: string, familiarId = FAMILIAR) {
  return upsertXPublicationDraft({ familiarId, text });
}

async function statusOf(id: string, familiarId = FAMILIAR) {
  const all = await listXPublications(familiarId);
  return all.find((entry) => entry.id === id);
}

test("a confirmed draft publishes once and records the post id and canonical URL", async () => {
  const { publication, confirmationToken } = await draft("Ship it.");
  assert.equal(publication.status, "draft");
  assert.equal(publication.postId, undefined);

  const sent: string[] = [];
  const result = await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    recordingSend(sent),
  );

  assert.deepEqual(sent, ["Ship it."]);
  assert.equal(result.alreadyPublished, false);
  assert.equal(result.publication.status, "published");
  assert.equal(result.publication.postId, POST_ID);
  assert.equal(result.publication.canonicalUrl, `https://x.com/novaops/status/${POST_ID}`);
  assert.ok(result.publication.publishedAt, "records when it went out");
  assert.equal(result.publication.dispatchedAt, undefined, "the in-flight marker is cleared");

  // Durable: a fresh read sees the same record.
  assert.equal((await statusOf(publication.id))?.canonicalUrl, result.publication.canonicalUrl);
});

test("publishing without the confirmation token sends nothing", async () => {
  const { publication } = await draft("Unconfirmed.");
  const sent: string[] = [];

  for (const token of [undefined, "", "not-the-token", 42]) {
    await assert.rejects(
      publishXPublication(
        { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken: token },
        recordingSend(sent),
      ),
      (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
    );
  }

  assert.deepEqual(sent, [], "no attempt reached the client");
  assert.equal((await statusOf(publication.id))?.status, "draft", "the draft is untouched");
});

test("editing a draft invalidates the token minted for the old wording", async () => {
  const first = await draft("Version one.");
  const second = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    publicationId: first.publication.id,
    text: "Version two, materially different.",
  });

  assert.notEqual(second.confirmationToken, first.confirmationToken);

  const sent: string[] = [];
  // This is the whole point of binding the token to the text: an approval
  // given for one wording must not silently carry to another.
  await assert.rejects(
    publishXPublication(
      {
        familiarId: FAMILIAR,
        publicationId: first.publication.id,
        confirmationToken: first.confirmationToken,
      },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, []);

  const ok = await publishXPublication(
    {
      familiarId: FAMILIAR,
      publicationId: first.publication.id,
      confirmationToken: second.confirmationToken,
    },
    recordingSend(sent),
  );
  assert.deepEqual(sent, ["Version two, materially different."]);
  assert.equal(ok.publication.status, "published");
});

test("a token minted for one record does not validate another", async () => {
  const a = await draft("Same text.");
  const b = await draft("Same text.");
  assert.notEqual(a.publication.id, b.publication.id);

  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: b.publication.id, confirmationToken: a.confirmationToken },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, [], "identical text is not enough — the token names the record");
});

test("publishing an already-published record returns it without sending again", async () => {
  const { publication, confirmationToken } = await draft("Only once.");
  const sent: string[] = [];
  await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    recordingSend(sent),
  );

  const again = await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    recordingSend(sent),
  );

  assert.deepEqual(sent, ["Only once."], "a double submit posts once");
  assert.equal(again.alreadyPublished, true);
  assert.equal(again.publication.postId, POST_ID);
});

test("an ambiguous write leaves the record uncertain and refuses to retry", async () => {
  const { publication, confirmationToken } = await draft("Did this land?");
  const attempts: string[] = [];

  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      ambiguousSend(attempts),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "ambiguous-write",
  );

  const stored = await statusOf(publication.id);
  assert.equal(stored?.status, "uncertain");
  assert.ok(stored?.dispatchedAt, "the dispatch is on the record");
  assert.equal(stored?.postId, undefined, "nothing is claimed about the outcome");

  // The load-bearing assertion: a second publish must not send. The first
  // attempt may already have posted, and retrying would duplicate it.
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      ambiguousSend(attempts),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "ambiguous-write",
  );
  assert.equal(attempts.length, 1, "the second publish never reached the client");
});

test("a definite refusal returns the record to draft so it can be tried again", async () => {
  const { publication, confirmationToken } = await draft("Refused once.");
  const attempts: string[] = [];

  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      refusedSend(attempts),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );

  // X received the request and rejected it, so nothing was posted and the
  // draft is safe to retry — unlike the ambiguous case above.
  const stored = await statusOf(publication.id);
  assert.equal(stored?.status, "draft");
  assert.equal(stored?.dispatchedAt, undefined);

  const sent: string[] = [];
  const ok = await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    recordingSend(sent),
  );
  assert.equal(ok.publication.status, "published");
  assert.deepEqual(sent, ["Refused once."]);
});

test("the record is written as uncertain before the send, not after", async () => {
  const { publication, confirmationToken } = await draft("Crash window.");
  let observed: string | undefined;

  await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    {
      // Reading from disk mid-send is the only way to prove the ordering. If
      // the record still said "draft" here, a crash at this instant would
      // leave a draft that looks safe to publish — and posting it again is
      // exactly the duplicate this ordering prevents.
      send: async () => {
        observed = (await statusOf(publication.id))?.status;
        return { id: POST_ID };
      },
      accountUsername: () => "novaops",
    },
  );

  assert.equal(observed, "uncertain");
});

test("a human resolves an uncertain record; the machine never guesses", async () => {
  const { publication, confirmationToken } = await draft("Landed after all.");
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      ambiguousSend([]),
    ),
  );

  const resolved = await resolveXPublication({
    familiarId: FAMILIAR,
    publicationId: publication.id,
    outcome: "published",
    postId: POST_ID,
    note: "Found it on the timeline.",
    accountUsername: "novaops",
  });

  assert.equal(resolved.status, "published");
  assert.equal(resolved.postId, POST_ID);
  assert.equal(resolved.canonicalUrl, `https://x.com/novaops/status/${POST_ID}`);
  assert.equal(resolved.resolutionNote, "Found it on the timeline.");
  assert.equal(resolved.dispatchedAt, undefined);
});

test("resolving as published requires a real post id", async () => {
  const { publication } = await draft("No id offered.");
  for (const postId of [undefined, "", "not-numeric", "12a3"]) {
    await assert.rejects(
      resolveXPublication({
        familiarId: FAMILIAR,
        publicationId: publication.id,
        outcome: "published",
        postId,
      }),
      (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
    );
  }
});

test("an abandoned record is terminal for both publishing and editing", async () => {
  const { publication, confirmationToken } = await draft("Never mind.");
  const abandoned = await resolveXPublication({
    familiarId: FAMILIAR,
    publicationId: publication.id,
    outcome: "abandoned",
    note: "Superseded.",
  });
  assert.equal(abandoned.status, "abandoned");

  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  await assert.rejects(
    upsertXPublicationDraft({
      familiarId: FAMILIAR,
      publicationId: publication.id,
      text: "Reopened by the back door.",
    }),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, []);
});

test("a published record cannot be rewritten to falsify what was sent", async () => {
  const { publication, confirmationToken } = await draft("As sent.");
  await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    recordingSend([]),
  );

  await assert.rejects(
    upsertXPublicationDraft({
      familiarId: FAMILIAR,
      publicationId: publication.id,
      text: "Not what went out.",
    }),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.equal((await statusOf(publication.id))?.text, "As sent.");
});

test("records are familiar-scoped in both directions", async () => {
  const mine = await draft("Nova's post.", FAMILIAR);
  const theirs = await draft("Cody's post.", OTHER_FAMILIAR);

  assert.deepEqual(
    (await listXPublications(FAMILIAR)).map((entry) => entry.text),
    ["Nova's post."],
  );
  assert.deepEqual(
    (await listXPublications(OTHER_FAMILIAR)).map((entry) => entry.text),
    ["Cody's post."],
  );

  // Reaching across with a valid id from the other familiar finds nothing —
  // the store is per-familiar, so this cannot become a disclosure.
  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      {
        familiarId: FAMILIAR,
        publicationId: theirs.publication.id,
        confirmationToken: theirs.confirmationToken,
      },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "not-found",
  );
  assert.deepEqual(sent, []);
  assert.equal(await statusOf(mine.publication.id) !== undefined, true);
});

test("empty and oversized text are refused before anything is stored", async () => {
  for (const text of ["", "   ", "\n"]) {
    await assert.rejects(
      upsertXPublicationDraft({ familiarId: FAMILIAR, text }),
      (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
    );
  }
  await assert.rejects(
    upsertXPublicationDraft({ familiarId: FAMILIAR, text: "x".repeat(16 * 1024 + 1) }),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(await listXPublications(FAMILIAR), []);
});

test("an invalid familiar id never becomes a path", async () => {
  for (const familiarId of ["../escape", "nova/../cody", ""]) {
    await assert.rejects(
      upsertXPublicationDraft({ familiarId, text: "Nope." }),
      (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
    );
  }
});

test("a malformed store is quarantined rather than read or deleted", async () => {
  await draft("Real record.");
  const target = path.join(publicationsDir, `${FAMILIAR}.json`);
  await writeFile(target, "{ this is not json", "utf8");

  assert.deepEqual(await listXPublications(FAMILIAR), [], "nothing is invented from the wreckage");

  // `.corrupt-` specifically: the lock directory also sits at `<file>.locks`.
  const aside = (await readdir(publicationsDir))
    .filter((name) => name.startsWith(`${FAMILIAR}.json.corrupt-`));
  assert.equal(aside.length, 1, "the unreadable file is kept for inspection");
  assert.equal(await readFile(path.join(publicationsDir, aside[0]!), "utf8"), "{ this is not json");
});

test("two overlapping publishes of one draft send exactly once", async () => {
  const { publication, confirmationToken } = await draft("Exactly once, under contention.");
  const sent: string[] = [];
  const dependencies = {
    // Held open so both calls are genuinely in flight together: the loser must
    // be stopped by the record's own state, not by arriving after the winner
    // finished. The send deliberately runs outside the store's lock, so this
    // is the window in which a second caller could slip through.
    send: async (text: string) => {
      sent.push(text);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { id: POST_ID };
    },
    accountUsername: () => "novaops",
  };

  const attempt = () => publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    dependencies,
  );
  const results = await Promise.allSettled([attempt(), attempt()]);

  assert.deepEqual(sent, ["Exactly once, under contention."], "one post, not two");
  const refused = results.filter((result) => result.status === "rejected");
  assert.equal(refused.length, 1, "the second caller is refused rather than served a second send");
  const reason = (refused[0] as PromiseRejectedResult).reason as unknown;
  assert.ok(
    reason instanceof XApiError && reason.code === "ambiguous-write",
    "and refused as ambiguous, because the first attempt's outcome is not yet known",
  );
  assert.equal((await statusOf(publication.id))?.status, "published");
});

test("a same-length or multi-byte token is refused, never crashed", async () => {
  const { publication, confirmationToken } = await draft("Forge me.");
  const sent: string[] = [];
  const forged = `${confirmationToken[0] === "0" ? "1" : "0"}${confirmationToken.slice(1)}`;
  assert.equal(forged.length, confirmationToken.length);
  assert.notEqual(forged, confirmationToken);
  // 64 characters but 128 bytes: `timingSafeEqual` throws on a byte-length
  // mismatch, so a string-length pre-check would turn a refusal into a 500.
  const multiByte = "é".repeat(confirmationToken.length);

  for (const token of [forged, multiByte]) {
    await assert.rejects(
      publishXPublication(
        { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken: token },
        recordingSend(sent),
      ),
      (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
    );
  }
  assert.deepEqual(sent, []);
  assert.equal((await statusOf(publication.id))?.status, "draft");
});

test("an unusable confirmation key is replaced, and every token minted under the old one dies", async () => {
  const { publication, confirmationToken } = await draft("Keyed to this install.");
  const keyPath = path.join(publicationsDir, ".confirmation-key");
  const original = await readFile(keyPath, "utf8");
  await writeFile(keyPath, "truncated", "utf8");

  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, [], "a token that cannot be verified is not honoured");

  const replaced = await readFile(keyPath, "utf8");
  assert.notEqual(replaced, original);
  assert.equal(Buffer.from(replaced.trim(), "base64").length, 32, "a real key replaces the wreckage");
});

test("a usable confirmation key is adopted, not rotated, on every mint", async () => {
  await draft("First.");
  const keyPath = path.join(publicationsDir, ".confirmation-key");
  const key = await readFile(keyPath, "utf8");

  const second = await draft("Second.");
  assert.equal(await readFile(keyPath, "utf8"), key, "minting never replaces a working key");

  // The proof that matters: a token minted earlier still publishes.
  const sent: string[] = [];
  const ok = await publishXPublication(
    {
      familiarId: FAMILIAR,
      publicationId: second.publication.id,
      confirmationToken: second.confirmationToken,
    },
    recordingSend(sent),
  );
  assert.equal(ok.publication.status, "published");
});

test("a stored record contradicting itself is quarantined, not offered for publishing", async () => {
  const target = path.join(publicationsDir, `${FAMILIAR}.json`);
  const base = {
    id: "00000000-0000-4000-8000-000000000000",
    familiarId: FAMILIAR,
    text: "Contradiction.",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const contradictions = [
    // Says a post already exists, yet invites the action that would send it
    // again — the exact shape that produces a duplicate.
    { ...base, status: "draft", postId: POST_ID, canonicalUrl: `https://x.com/novaops/status/${POST_ID}`, publishedAt: base.updatedAt },
    // Claims an unknown outcome with nothing in flight.
    { ...base, status: "uncertain" },
    // Claims something is in flight when the record is settled.
    { ...base, status: "abandoned", dispatchedAt: base.updatedAt },
  ];

  for (const publication of contradictions) {
    await mkdir(publicationsDir, { recursive: true });
    await writeFile(target, JSON.stringify({ version: 1, publications: [publication] }), "utf8");
    assert.deepEqual(
      await listXPublications(FAMILIAR),
      [],
      `${publication.status} record is not read back`,
    );
    const aside = (await readdir(publicationsDir))
      .filter((name) => name.startsWith(`${FAMILIAR}.json.corrupt-`));
    assert.equal(aside.length, 1, "the bytes are preserved rather than dropped");
    for (const name of aside) await rm(path.join(publicationsDir, name));
  }
});

test("a confirmation older than ten minutes is refused, and sends nothing", async () => {
  const mintedAt = new Date("2026-08-01T12:00:00.000Z");
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    text: "Reviewed this morning.",
    now: mintedAt,
  });

  const sent: string[] = [];
  // Ten minutes and one second later. The wording is untouched and the record
  // is still a draft — the ONLY thing wrong is that nobody has looked at this
  // text recently, which is the whole point of the window.
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      {
        ...recordingSend(sent),
        now: () => new Date(mintedAt.getTime() + 10 * 60 * 1000 + 1000),
      },
    ),
    (error: unknown) =>
      error instanceof XApiError
      && error.code === "invalid-request"
      // Distinct from the "has not been confirmed" refusal: a stale approval
      // is repaired by re-reading the text, not by hunting for a lost token.
      && /expired/i.test(error.message),
  );

  assert.deepEqual(sent, []);
  assert.equal((await statusOf(publication.id))?.status, "draft", "still publishable after review");
});

test("a confirmation inside the window still publishes", async () => {
  const mintedAt = new Date("2026-08-01T12:00:00.000Z");
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    text: "Reviewed nine minutes ago.",
    now: mintedAt,
  });

  const sent: string[] = [];
  const ok = await publishXPublication(
    { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
    {
      ...recordingSend(sent),
      now: () => new Date(mintedAt.getTime() + 9 * 60 * 1000),
    },
  );

  assert.equal(ok.publication.status, "published");
  assert.deepEqual(sent, ["Reviewed nine minutes ago."]);
});

test("the confirmation window cannot be extended by rewriting the token's timestamp", async () => {
  const mintedAt = new Date("2026-08-01T12:00:00.000Z");
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    text: "Stale, and someone wants it fresh.",
    now: mintedAt,
  });

  // The stamp travels in the clear so verification needs no server-side state.
  // It is inside the MAC, so moving it forward invalidates the whole token
  // rather than buying another ten minutes.
  const digest = confirmationToken.slice(confirmationToken.indexOf(".") + 1);
  const now = new Date(mintedAt.getTime() + 60 * 60 * 1000);
  const forwarded = `${now.getTime()}.${digest}`;

  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken: forwarded },
      { ...recordingSend(sent), now: () => now },
    ),
    (error: unknown) =>
      error instanceof XApiError
      && error.code === "invalid-request"
      // Not "expired": a rewritten stamp is not a token this install minted at
      // all, so it is refused as unconfirmed rather than as merely stale.
      && !/expired/i.test(error.message),
  );
  assert.deepEqual(sent, []);
});

test("a token whose timestamp is in the future is refused rather than trusted", async () => {
  const mintedAt = new Date("2026-08-01T12:00:00.000Z");
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    text: "Minted after the clock went back.",
    now: mintedAt,
  });

  const sent: string[] = [];
  await assert.rejects(
    publishXPublication(
      { familiarId: FAMILIAR, publicationId: publication.id, confirmationToken },
      // The machine's clock moved backwards between mint and publish. Honouring
      // this would make the window unbounded on any drifting clock.
      { ...recordingSend(sent), now: () => new Date(mintedAt.getTime() - 60 * 1000) },
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, []);
});

test("a confirmation minted for one account cannot publish through another", async () => {
  const { publication, confirmationToken } = await upsertXPublicationDraft({
    familiarId: FAMILIAR,
    text: "Post this as Nova.",
    accountId: "account-a",
  });
  const sent: string[] = [];

  await assert.rejects(
    publishXPublication(
      {
        familiarId: FAMILIAR,
        publicationId: publication.id,
        confirmationToken,
        accountId: "account-b",
      },
      recordingSend(sent),
    ),
    (error: unknown) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(sent, []);
  assert.equal((await statusOf(publication.id))?.status, "draft");
});

test("a stored record claiming published without its post id is rejected wholesale", async () => {
  const { publication } = await draft("Half a record.");
  const target = path.join(publicationsDir, `${FAMILIAR}.json`);
  const file = JSON.parse(await readFile(target, "utf8")) as {
    version: number;
    publications: Record<string, unknown>[];
  };
  file.publications[0]!.status = "published";
  await writeFile(target, JSON.stringify(file), "utf8");

  // "Published, but we lost where" is worse than no record: it would read as
  // a sent post whose URL nobody can check.
  assert.deepEqual(await listXPublications(FAMILIAR), []);
  assert.equal(await statusOf(publication.id), undefined);
});
