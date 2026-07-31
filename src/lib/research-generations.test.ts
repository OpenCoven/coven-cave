import assert from "node:assert/strict";
import test from "node:test";

import {
  isResearchGenerationContent,
  isResearchGenerationCreatableKind,
  isResearchGenerationKind,
  isResearchGenerationMediaKind,
  isResearchGenerationProgress,
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  RESEARCH_GENERATION_KINDS,
  RESEARCH_GENERATION_MEDIA_KINDS,
  RESEARCH_GENERATION_STAGES,
  RESEARCH_GENERATION_STATUSES,
  validateCreateResearchGenerationInput,
  validateResearchMediaRenderConfig,
} from "./research-generations.ts";

test("extractive and media kind unions stay explicit and composable", () => {
  assert.deepEqual(
    [...RESEARCH_GENERATION_KINDS],
    ["diagram", "blog", "slides", "infographic", "thread"],
  );
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.equal(isResearchGenerationKind(media.kind), false, media.kind);
    assert.equal(isResearchGenerationMediaKind(media.kind), true, media.kind);
    assert.equal(isResearchGenerationCreatableKind(media.kind), true, media.kind);
  }
  assert.equal(isResearchGenerationCreatableKind("slides"), true);
  assert.equal(isResearchGenerationMediaKind("slides"), false);
});

test("media kinds carry capability copy rather than stale readiness claims", () => {
  assert.deepEqual(
    RESEARCH_GENERATION_MEDIA_KINDS,
    [
      {
        kind: "podcast",
        label: "Podcast",
        hint: "An audio briefing narrated from the artifact's cited findings.",
      },
      {
        kind: "short-video",
        label: "Short video",
        hint: "A concise video built from the artifact's key claims.",
      },
      {
        kind: "long-video",
        label: "Long video",
        hint: "A chaptered video built from the artifact's sections.",
      },
    ],
  );
});

test("statuses expose honest async lifecycle states alongside terminal states", () => {
  assert.deepEqual([...RESEARCH_GENERATION_STATUSES], [
    "draft",
    "queued",
    "rendering",
    "ready",
    "failed",
    "cancelled",
  ]);
});

test("media progress uses coarse persisted stages, never invented percentages", () => {
  assert.deepEqual([...RESEARCH_GENERATION_STAGES], ["scripting", "synthesizing", "encoding"]);
});

test("media render configuration is kind-aware, trimmed, and bounded", () => {
  assert.deepEqual(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: " piper-lessac-medium ",
      length: "standard",
    }),
    {
      ok: true,
      value: {
        provider: "local",
        voice: "piper-lessac-medium",
        length: "standard",
      },
    },
  );
  assert.equal(
    validateResearchMediaRenderConfig("short-video", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "extended",
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("blog", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "x".repeat(129),
      length: "brief",
    }).ok,
    false,
  );
});

test("chapter progress accepts bounded real units and rejects invented ranges", () => {
  assert.equal(
    isResearchGenerationProgress({
      unit: "chapter",
      current: 2,
      total: 4,
      label: "Methods",
    }),
    true,
  );
  assert.equal(
    isResearchGenerationProgress({
      unit: "chapter",
      current: 0,
      total: 4,
      label: "Methods",
    }),
    false,
  );
  assert.equal(
    isResearchGenerationProgress({
      unit: "chapter",
      current: 2,
      total: 65,
      label: "Methods",
    }),
    false,
  );
  assert.equal(
    isResearchGenerationProgress({
      unit: "percent",
      current: 50,
      total: 100,
      label: "Encoding",
    }),
    false,
  );
});

test("media creation is explicitly capability-gated", () => {
  const input = {
    familiarId: "nova",
    kind: "podcast",
    sourceMissionId: "mission-1",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
    },
  };
  const blocked = validateCreateResearchGenerationInput(input);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /media generation is not enabled/);

  const allowed = validateCreateResearchGenerationInput(input, { allowMedia: true });
  assert.ok(allowed.ok);
  if (allowed.ok) {
    assert.equal(allowed.value.kind, "podcast");
    assert.deepEqual(allowed.value.renderConfig, input.renderConfig);
  }

  const missingConfig = validateCreateResearchGenerationInput(
    {
      familiarId: "nova",
      kind: "podcast",
      sourceMissionId: "mission-1",
    },
    { allowMedia: true },
  );
  assert.equal(missingConfig.ok, false);
  if (!missingConfig.ok) assert.match(missingConfig.error, /render config/i);

  const extractiveConfig = validateCreateResearchGenerationInput({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-1",
    renderConfig: input.renderConfig,
  });
  assert.equal(extractiveConfig.ok, false);
  if (!extractiveConfig.ok) assert.match(extractiveConfig.error, /render config/i);
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
    directions: "  aimed at eng leadership  ",
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
    [{ familiarId: "nova", kind: "podcast", sourceMissionId: "m-1" }, /media generation is not enabled/],
    [{ familiarId: "nova", kind: "short-video", sourceMissionId: "m-1" }, /media generation is not enabled/],
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
  assert.ok(
    isResearchGenerationContent({
      kind: "podcast",
      script: [{ id: "segment-1", text: "A source-grounded narration." }],
    }),
  );
  assert.ok(
    isResearchGenerationContent({
      kind: "short-video",
      storyboard: [
        { id: "scene-1", title: "Opening", bullets: ["A source claim"], narration: "A source claim" },
      ],
    }),
  );
  assert.ok(
    isResearchGenerationContent({
      kind: "long-video",
      chapters: [
        {
          id: "chapter-1",
          title: "Methods",
          scenes: [
            {
              id: "scene-1",
              title: "Method A",
              bullets: ["Source-grounded detail"],
              narration: "Method A. Source-grounded detail",
            },
          ],
        },
      ],
      video: {
        key: "generation.mp4",
        mimeType: "video/mp4",
        sizeBytes: 42,
        durationMs: 1200,
        provider: "local",
        voice: "piper-lessac-medium",
      },
    }),
  );

  assert.equal(isResearchGenerationContent(null), false);
  assert.equal(isResearchGenerationContent({ kind: "blog" }), false);
  assert.equal(isResearchGenerationContent({ kind: "slides", slides: [{ title: "t" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "thread", posts: [{ pre: "1/1" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "podcast", script: [{ text: "missing id" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "short-video", storyboard: [{ id: "s" }] }), false);
  assert.equal(isResearchGenerationContent({ kind: "podcast", script: [], audio: { key: "x", mimeType: "audio/wav", sizeBytes: -1 } }), false);
  assert.equal(isResearchGenerationContent({ kind: "long-video", storyboard: [] }), false);
  assert.equal(
    isResearchGenerationContent({
      kind: "podcast",
      script: [],
      audio: {
        key: "generation.wav",
        mimeType: "audio/wav",
        sizeBytes: 42,
        provider: "local",
        voice: " ",
      },
    }),
    false,
  );
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
