import assert from "node:assert/strict";
import test from "node:test";

import {
  isResearchGenerationContent,
  isResearchGenerationKind,
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  RESEARCH_GENERATION_KINDS,
  RESEARCH_GENERATION_MEDIA_KINDS,
  RESEARCH_GENERATION_STATUSES,
  validateCreateResearchGenerationInput,
} from "./research-generations.ts";

test("kind union covers exactly the five extractive kinds — no media kinds", () => {
  assert.deepEqual(
    [...RESEARCH_GENERATION_KINDS],
    ["diagram", "blog", "slides", "infographic", "thread"],
  );
  // podcast/short-video/long-video need a media pipeline that does not exist;
  // they must never be creatable kinds.
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.equal(isResearchGenerationKind(media.kind), false, media.kind);
  }
});

test("disabled media kinds carry an honest hint for the Studio cards", () => {
  assert.deepEqual(
    RESEARCH_GENERATION_MEDIA_KINDS.map((media) => media.kind),
    ["podcast", "short-video", "long-video"],
  );
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.equal(media.hint, "Needs a media pipeline — not available yet.");
    assert.ok(media.label.length > 0);
  }
});

test("statuses have no fake progress states — drafting is synchronous", () => {
  assert.deepEqual([...RESEARCH_GENERATION_STATUSES], ["ready", "failed", "cancelled"]);
});

test("create input validation accepts a well-formed request and trims it", () => {
  const result = validateCreateResearchGenerationInput({
    familiarId: " nova ",
    kind: "slides",
    sourceMissionId: " mission-1 ",
    directions: "  aimed at eng leadership  ",
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    familiarId: "nova",
    kind: "slides",
    sourceMissionId: "mission-1",
    directions: "aimed at eng leadership",
  });
});

test("empty directions are dropped, not stored as an empty string", () => {
  const result = validateCreateResearchGenerationInput({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-1",
    directions: "   ",
  });
  assert.ok(result.ok);
  assert.equal("directions" in result.value, false);
});

test("create input validation rejects bad shapes with specific errors", () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /input required/],
    [[], /input required/],
    [{ familiarId: "../evil", kind: "blog", sourceMissionId: "m-1" }, /familiar id/],
    [{ familiarId: "", kind: "blog", sourceMissionId: "m-1" }, /familiar id/],
    [{ familiarId: "nova", kind: "podcast", sourceMissionId: "m-1" }, /generation kind/],
    [{ familiarId: "nova", kind: "short-video", sourceMissionId: "m-1" }, /generation kind/],
    [{ familiarId: "nova", kind: "blog", sourceMissionId: "Not A Mission!" }, /mission id/],
    [{ familiarId: "nova", kind: "blog", sourceMissionId: "" }, /mission id/],
    [{ familiarId: "nova", kind: "blog", sourceMissionId: "m-1", directions: 7 }, /directions/],
    [
      {
        familiarId: "nova",
        kind: "blog",
        sourceMissionId: "m-1",
        directions: "x".repeat(RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH + 1),
      },
      /at most/,
    ],
  ];
  for (const [input, expected] of cases) {
    const result = validateCreateResearchGenerationInput(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, expected);
  }
});

test("content guard enforces the per-kind discriminated union", () => {
  assert.ok(isResearchGenerationContent({ kind: "blog", markdown: "# hi" }));
  assert.ok(isResearchGenerationContent({ kind: "diagram", mermaid: "graph TD" }));
  assert.ok(
    isResearchGenerationContent({ kind: "slides", slides: [{ title: "t", bullets: ["b"] }] }),
  );
  assert.ok(
    isResearchGenerationContent({ kind: "thread", posts: [{ pre: "1/1", text: "t" }] }),
  );
  assert.ok(
    isResearchGenerationContent({
      kind: "infographic",
      stats: [{ value: "4–9×", context: "cost gap" }],
    }),
  );

  assert.equal(isResearchGenerationContent(null), false);
  assert.equal(isResearchGenerationContent({ kind: "blog" }), false);
  assert.equal(isResearchGenerationContent({ kind: "slides", slides: [{ title: "t" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "thread", posts: [{ pre: "1/1" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "podcast", url: "x" }), false);
});

test("client fetchers hit /api/research/generations with the expected shapes", async (t) => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ ok: true, generations: [] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { listResearchGenerations, createResearchGeneration, removeResearchGeneration } =
    await import("./research-generations.ts");

  await listResearchGenerations("nova/../etc");
  assert.equal(
    calls[0].input,
    `/api/research/generations?familiarId=${encodeURIComponent("nova/../etc")}`,
    "familiarId is URL-encoded into the query",
  );

  await createResearchGeneration({
    familiarId: "nova",
    kind: "thread",
    sourceMissionId: "m-1",
  });
  assert.equal(calls[1].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    familiarId: "nova",
    kind: "thread",
    sourceMissionId: "m-1",
  });

  await removeResearchGeneration("gen-1", "nova");
  assert.equal(calls[2].init?.method, "DELETE");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    id: "gen-1",
    familiarId: "nova",
  });
});
