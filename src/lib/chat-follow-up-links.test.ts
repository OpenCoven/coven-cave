// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

let subject;
try {
  subject = await import("./chat-follow-up-links.ts");
} catch {
  assert.fail("chat-follow-up-links helper must be implemented");
}

const { linksFromFollowUpSource, saveFollowUpLinks } = subject;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("extracts public links and dedupes normalized equivalents in first-seen order", () => {
  const links = linksFromFollowUpSource(`
    First https://Example.com/docs/
    Duplicate https://example.com/docs#intro
    Then https://second.dev/path?view=full.
    Ignore http://localhost/private, http://[::1]/private, and \`https://hidden.dev/code\`.
  `);

  assert.deepEqual(links, [
    "https://example.com/docs",
    "https://second.dev/path?view=full",
  ]);
});

test("rejects loopback and unspecified hosts while retaining public IPv6", () => {
  const links = linksFromFollowUpSource([
    "http://LOCALHOST./private",
    "http://foo.localhost/private",
    "http://127.0.0.2/private",
    "http://[::1]/private",
    "http://[::]/private",
    "http://[::ffff:127.0.0.1]/private",
    "https://127.example.com/public",
    "https://[2001:4860:4860::8888]/public",
  ].join("\n"));

  assert.deepEqual(links, [
    "https://127.example.com/public",
    "https://[2001:4860:4860::8888]/public",
  ]);
});

test("extracts only links represented in the rendered assistant turn", () => {
  const links = linksFromFollowUpSource([
    "<reasoning>Privately inspect https://hidden.example/reasoning</reasoning>",
    '<coven:image src="https://hidden.example/image.png" alt="Hidden preview" />',
    '<coven:github kind="issue" repo="OpenCoven/coven-cave" number="42" />',
    "Use the visible guide: https://visible.example/guide.",
    '<coven:preview url="https://hidden.example/invalid-preview" title="Hidden preview" />',
    '<coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="99" note="https://hidden.example/action" />',
    "<coven:next-paths>",
    "- [action:save-link] Save https://hidden.example/control",
    "</coven:next-paths>",
  ].join("\n"));

  assert.deepEqual(links, [
    "https://github.com/OpenCoven/coven-cave/issues/42",
    "https://visible.example/guide",
  ]);
});

test("preserves balanced parentheses in URLs and removes surrounding punctuation", () => {
  const wiki = "https://en.wikipedia.org/wiki/Function_(mathematics)";

  assert.deepEqual(linksFromFollowUpSource(wiki), [wiki]);
  assert.deepEqual(
    linksFromFollowUpSource(`Read [Function](${wiki}). Then compare ${wiki}).`),
    [wiki],
  );
});

test("saves links to Research Resources and reports every server count", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({
      ok: true,
      added: [{
        id: "link-1",
        url: "https://one.dev",
        category: "other",
        title: "one.dev",
        addedAt: "2026-08-16T00:00:00.000Z",
        source: "chat",
      }],
      duplicates: ["https://two.dev"],
      invalid: ["not-a-url"],
    });
  };

  const result = await saveFollowUpLinks({
    destination: "resources",
    urls: ["https://one.dev", "https://two.dev", "not-a-url"],
  }, fetchImpl);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "/api/research/links");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    urls: ["https://one.dev", "https://two.dev", "not-a-url"],
    source: "chat",
  });
  assert.deepEqual(result, {
    ok: true,
    message: "1 saved, 1 already saved, 1 invalid in Research Resources.",
  });
});

test("accepts normalized-equivalent URLs while accounting for every Resources result", async () => {
  const result = await saveFollowUpLinks({
    destination: "resources",
    urls: ["https://Example.com/docs/#intro"],
  }, async () => jsonResponse({
    ok: true,
    added: [{
      id: "link-1",
      url: "https://example.com/docs",
      category: "docs",
      title: "Docs",
      addedAt: "2026-08-16T00:00:00.000Z",
      source: "chat",
    }],
    duplicates: [],
    invalid: [],
  }));

  assert.deepEqual(result, {
    ok: true,
    message: "1 saved, 0 already saved, 0 invalid in Research Resources.",
  });
});

test("accepts the Resources endpoint's canonical paper URL for an arXiv request", async () => {
  const result = await saveFollowUpLinks({
    destination: "resources",
    urls: ["https://arxiv.org/pdf/2401.12345v2.pdf"],
  }, async () => jsonResponse({
    ok: true,
    added: [{
      id: "link-paper",
      url: "https://huggingface.co/papers/2401.12345",
      category: "paper",
      title: "Paper",
      addedAt: "2026-08-16T00:00:00.000Z",
      source: "chat",
    }],
    duplicates: [],
    invalid: [],
  }));

  assert.deepEqual(result, {
    ok: true,
    message: "1 saved, 0 already saved, 0 invalid in Research Resources.",
  });
});

test("verifies truthful added/duplicate outcomes for the returned current task", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({
      ok: true,
      card: {
        id: "task/one ?",
        links: ["https://example.com/docs", "https://two.dev/"],
      },
      opsOutcome: {
        linkOps: [
          { requestedUrl: "https://Example.com/docs/#intro", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
          { requestedUrl: "https://two.dev", normalizedUrl: "https://two.dev", outcome: "added" },
        ],
      },
    });
  };

  const result = await saveFollowUpLinks({
    destination: "task",
    taskId: "task/one ?",
    urls: ["https://Example.com/docs/#intro", "https://two.dev"],
  }, fetchImpl);

  assert.equal(calls[0].input, "/api/board/task%2Fone%20%3F");
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ops: {
      linkOps: [
        { op: "addNormalizedUrl", value: "https://Example.com/docs/#intro" },
        { op: "addNormalizedUrl", value: "https://two.dev" },
      ],
    },
  });
  assert.deepEqual(result, {
    ok: true,
    message: "1 added, 1 already on the task, 0 invalid for the current task.",
  });
});

test("uses singular current-task wording when every request is genuinely added", async () => {
  const result = await saveFollowUpLinks({
    destination: "task",
    taskId: "task-1",
    urls: ["https://one.dev"],
  }, async () => jsonResponse({
    ok: true,
    card: { id: "task-1", links: ["https://one.dev"] },
    opsOutcome: {
      linkOps: [{ requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" }],
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    message: "1 selected link is now on the current task.",
  });
});

test("preserves every pre-existing human-authored link and reports the new one added", async () => {
  const result = await saveFollowUpLinks({
    destination: "task",
    taskId: "task-1",
    urls: ["https://brand-new.dev"],
  }, async () => jsonResponse({
    ok: true,
    card: {
      id: "task-1",
      links: ["https://human.example/note?keep=1#raw", "https://another.example/kept", "https://brand-new.dev"],
    },
    opsOutcome: {
      linkOps: [{ requestedUrl: "https://brand-new.dev", normalizedUrl: "https://brand-new.dev", outcome: "added" }],
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    message: "1 selected link is now on the current task.",
  });
});

test("reports a mixed added/duplicate/invalid batch truthfully for the current task", async () => {
  const result = await saveFollowUpLinks({
    destination: "task",
    taskId: "task-1",
    urls: ["https://new.dev", "https://existing.dev", "not a url"],
  }, async () => jsonResponse({
    ok: true,
    card: { id: "task-1", links: ["https://existing.dev", "https://new.dev"] },
    opsOutcome: {
      linkOps: [
        { requestedUrl: "https://new.dev", normalizedUrl: "https://new.dev", outcome: "added" },
        { requestedUrl: "https://existing.dev", normalizedUrl: "https://existing.dev", outcome: "duplicate" },
        { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
      ],
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    message: "1 added, 1 already on the task, 1 invalid for the current task.",
  });
});

test("rejects an empty selection without making a request", async () => {
  let called = false;
  const result = await saveFollowUpLinks(
    { destination: "resources", urls: [] },
    async () => {
      called = true;
      return jsonResponse({ ok: true, added: [], duplicates: [], invalid: [] });
    },
  );

  assert.equal(called, false);
  assert.deepEqual(result, { ok: false, error: "Select at least one link." });
});

test("prefers a documented server error for non-success responses", async () => {
  const result = await saveFollowUpLinks(
    { destination: "resources", urls: ["https://one.dev"] },
    async () => jsonResponse({ ok: false, error: "Saved-links store is unavailable." }, 503),
  );

  assert.deepEqual(result, { ok: false, error: "Saved-links store is unavailable." });
});

test("returns a documented HTTP 200 application error", async () => {
  const result = await saveFollowUpLinks(
    { destination: "resources", urls: ["https://one.dev"] },
    async () => jsonResponse({ ok: false, error: "Link storage is read-only." }),
  );

  assert.deepEqual(result, { ok: false, error: "Link storage is read-only." });
});

test("rejects malformed resource success responses", async () => {
  const result = await saveFollowUpLinks(
    { destination: "resources", urls: ["https://one.dev"] },
    async () => jsonResponse({ ok: true, added: "one", duplicates: [], invalid: [] }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects malformed task success responses missing an opsOutcome", async () => {
  for (const body of [
    { ok: true },
    { ok: true, card: { id: "task-1" } },
    { ok: true, card: { id: "task-1", links: ["https://one.dev"] } },
    { ok: true, card: { id: "task-1", links: ["https://one.dev"] }, opsOutcome: {} },
    { ok: true, card: { id: "task-1", links: ["https://one.dev"] }, opsOutcome: { linkOps: "not-an-array" } },
  ]) {
    const result = await saveFollowUpLinks(
      { destination: "task", taskId: "task-1", urls: ["https://one.dev"] },
      async () => jsonResponse(body),
    );
    assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
  }
});

test("rejects a task success response for a different card", async () => {
  const result = await saveFollowUpLinks(
    { destination: "task", taskId: "task-1", urls: ["https://one.dev"] },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-2", links: ["https://one.dev"] },
      opsOutcome: {
        linkOps: [{ requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" }],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects malformed JSON responses", async () => {
  const result = await saveFollowUpLinks(
    { destination: "task", taskId: "task-1", urls: ["https://one.dev"] },
    async () => new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects a task opsOutcome that omits one requested URL", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "https://two.dev"],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev"] },
      opsOutcome: {
        linkOps: [{ requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" }],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects a task opsOutcome whose order doesn't match the request", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "https://two.dev"],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev", "https://two.dev"] },
      opsOutcome: {
        linkOps: [
          { requestedUrl: "https://two.dev", normalizedUrl: "https://two.dev", outcome: "added" },
          { requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" },
        ],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects a task opsOutcome entry with an unrecognized outcome value", async () => {
  const result = await saveFollowUpLinks(
    { destination: "task", taskId: "task-1", urls: ["https://one.dev"] },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev"] },
      opsOutcome: {
        linkOps: [{ requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "saved" }],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects a task opsOutcome entry whose normalizedUrl/outcome contradicts its requested URL", async () => {
  const contradictoryEntries = [
    // "invalid" reported for a URL that is actually a parseable http(s) URL.
    { requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "invalid" },
    // "added"/"duplicate" reported for a request that isn't http(s) at all.
    { requestedUrl: "not a url", normalizedUrl: null, outcome: "added" },
    { requestedUrl: "mailto:team@example.com", normalizedUrl: null, outcome: "duplicate" },
    { requestedUrl: "ftp://example.com/file", normalizedUrl: null, outcome: "added" },
    // a non-null normalizedUrl paired with an invalid, uncanonicalizable request.
    { requestedUrl: "not a url", normalizedUrl: "https://one.dev", outcome: "invalid" },
    // a null normalizedUrl paired with an "added"/"duplicate" outcome for a valid URL.
    { requestedUrl: "https://one.dev", normalizedUrl: null, outcome: "added" },
    { requestedUrl: "https://one.dev", normalizedUrl: null, outcome: "duplicate" },
    // a normalizedUrl that parses, but isn't the canonical form of the request.
    { requestedUrl: "https://one.dev/", normalizedUrl: "https://one.dev/", outcome: "added" },
    // a normalizedUrl belonging to a completely different site than the request.
    { requestedUrl: "https://one.dev", normalizedUrl: "https://two.dev", outcome: "added" },
    // a malformed normalizedUrl type (neither null nor a string).
    { requestedUrl: "https://one.dev", normalizedUrl: 42, outcome: "added" },
  ];

  for (const entry of contradictoryEntries) {
    const result = await saveFollowUpLinks(
      { destination: "task", taskId: "task-1", urls: [entry.requestedUrl] },
      async () => jsonResponse({
        ok: true,
        card: { id: "task-1", links: [] },
        opsOutcome: { linkOps: [entry] },
      }),
    );
    assert.deepEqual(
      result,
      { ok: false, error: "Couldn't save links." },
      `rejects contradictory entry: ${JSON.stringify(entry)}`,
    );
  }
});

test("accepts a canonical-equivalent normalizedUrl for a differently-formatted request", async () => {
  const result = await saveFollowUpLinks(
    { destination: "task", taskId: "task-1", urls: ["https://One.Dev/path/?q=1#frag"] },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev/path?q=1"] },
      opsOutcome: {
        linkOps: [{
          requestedUrl: "https://One.Dev/path/?q=1#frag",
          normalizedUrl: "https://one.dev/path?q=1",
          outcome: "added",
        }],
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    message: "1 selected link is now on the current task.",
  });
});

test("accepts a mixed batch of internally-consistent valid and invalid outcomes", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "not a url", "https://two.dev"],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev", "https://two.dev"] },
      opsOutcome: {
        linkOps: [
          { requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" },
          { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
          { requestedUrl: "https://two.dev", normalizedUrl: "https://two.dev", outcome: "duplicate" },
        ],
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    message: "1 added, 1 already on the task, 1 invalid for the current task.",
  });
});

// A blank/whitespace-only requested URL is a runtime edge case (cave-onpeg):
// the server now always reports a positional "invalid" outcome for it rather
// than omitting the entry, and the client's own consistency check
// (`isConsistentLinkOpOutcome`) already treats a blank request the same as
// any other non-http(s) request — `normalizedHttpLinkKey` canonicalizes it
// to `null`, so a null `normalizedUrl` + "invalid" outcome is accepted.
test("accepts the server's truthful invalid outcome for a blank requested URL", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "   ", "https://two.dev"],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev", "https://two.dev"] },
      opsOutcome: {
        linkOps: [
          { requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" },
          { requestedUrl: "   ", normalizedUrl: null, outcome: "invalid" },
          { requestedUrl: "https://two.dev", normalizedUrl: "https://two.dev", outcome: "duplicate" },
        ],
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    message: "1 added, 1 already on the task, 1 invalid for the current task.",
  });
});

// If a server (or an older, pre-fix build) instead omits the outcome for a
// blank request — the exact bug this pass fixes — the client's positional
// length check must still reject it rather than silently under-counting.
test("rejects a task opsOutcome that omits the entry for a blank requested URL", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "   "],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev"] },
      opsOutcome: {
        linkOps: [{ requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" }],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects a mixed batch when only one entry contradicts its request", async () => {
  const result = await saveFollowUpLinks(
    {
      destination: "task",
      taskId: "task-1",
      urls: ["https://one.dev", "not a url"],
    },
    async () => jsonResponse({
      ok: true,
      card: { id: "task-1", links: ["https://one.dev"] },
      opsOutcome: {
        linkOps: [
          { requestedUrl: "https://one.dev", normalizedUrl: "https://one.dev", outcome: "added" },
          // "not a url" cannot canonicalize — reporting it added is a contradiction.
          { requestedUrl: "not a url", normalizedUrl: null, outcome: "added" },
        ],
      },
    }),
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});

test("rejects incomplete or unrelated Resources success accounting", async () => {
  const request = {
    destination: "resources",
    urls: ["https://one.dev", "https://two.dev"],
  };
  const savedLink = {
    id: "link-1",
    url: "https://one.dev",
    category: "other",
    title: "one.dev",
    addedAt: "2026-08-16T00:00:00.000Z",
    source: "chat",
  };

  for (const body of [
    { ok: true, added: [savedLink], duplicates: [], invalid: [] },
    {
      ok: true,
      added: [savedLink],
      duplicates: ["https://unrelated.dev"],
      invalid: [],
    },
  ]) {
    const result = await saveFollowUpLinks(request, async () => jsonResponse(body));
    assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
  }
});

test("turns network failures into a visible result", async () => {
  const result = await saveFollowUpLinks(
    { destination: "task", taskId: "task-1", urls: ["https://one.dev"] },
    async () => {
      throw new Error("offline");
    },
  );

  assert.deepEqual(result, { ok: false, error: "Couldn't save links." });
});
