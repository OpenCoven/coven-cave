import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  ELEVENLABS_DELIVERY_PRESETS,
  ELEVENLABS_PODCAST_MODEL_OPTIONS,
  describeElevenLabsVoiceSettings,
  elevenLabsDeliveryPreset,
} from "./voice/elevenlabs-shared.ts";
import {
  elevenLabsPodcastDirection,
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

test("generation directions use the shared 5,000-character ceiling", () => {
  assert.equal(RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH, 5_000);
  const overLimit = validateCreateResearchGenerationInput({
    familiarId: "nova", kind: "blog", sourceMissionId: "m-1",
    directions: "x".repeat(RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH + 1),
  });
  assert.equal(overLimit.ok, false);
  assert.equal(
    overLimit.ok ? null : overLimit.error,
    `directions must be at most ${RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH} characters`,
  );
  assert.equal(
    validateCreateResearchGenerationInput({
      familiarId: "nova", kind: "blog", sourceMissionId: "m-1",
      directions: "x".repeat(RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH),
    }).ok,
    true,
  );
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

test("per-speaker podcast voices are podcast-only, trimmed, and bounded", () => {
  assert.deepEqual(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      voices: { host: " piper-lessac-medium ", guest: " piper-amy " },
    }),
    {
      ok: true,
      value: {
        provider: "local",
        voice: "piper-lessac-medium",
        length: "standard",
        voices: { host: "piper-lessac-medium", guest: "piper-amy" },
      },
    },
  );
  // Single-voice configs stay exactly as before — no voices key appears.
  const single = validateResearchMediaRenderConfig("podcast", {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "standard",
  });
  assert.ok(single.ok);
  if (single.ok) assert.equal("voices" in single.value, false);
  assert.equal(
    validateResearchMediaRenderConfig("short-video", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
      voices: { host: "piper-lessac-medium", guest: "piper-amy" },
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      voices: { host: "piper-lessac-medium", guest: "  " },
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      voices: { host: "x".repeat(129), guest: "piper-amy" },
    }).ok,
    false,
  );
});

test("podcast style is podcast-only with an explicit vocabulary", () => {
  const styled = validateResearchMediaRenderConfig("podcast", {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "standard",
    style: "debate",
  });
  assert.deepEqual(styled, {
    ok: true,
    value: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      style: "debate",
    },
  });
  // Absent style stays absent — old stored configs revalidate byte-identical.
  const unstyled = validateResearchMediaRenderConfig("podcast", {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "standard",
  });
  assert.ok(unstyled.ok);
  if (unstyled.ok) assert.equal("style" in unstyled.value, false);
  assert.equal(
    validateResearchMediaRenderConfig("short-video", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
      style: "breakdown",
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      style: "freestyle",
    }).ok,
    false,
  );
});

test("podcast model and voice settings are ElevenLabs-only, podcast-only, and normalized", () => {
  assert.deepEqual(
    validateResearchMediaRenderConfig("podcast", {
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
      model: "eleven_v3",
      voiceSettings: { stability: 0.3 },
    }),
    {
      ok: true,
      value: {
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        length: "standard",
        model: "eleven_v3",
        voiceSettings: {
          stability: 0.3,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: true,
          speed: 1,
        },
      },
    },
  );
  // Absent model/voiceSettings stay absent — old configs revalidate unchanged.
  const bare = validateResearchMediaRenderConfig("podcast", {
    provider: "elevenlabs",
    voice: "21m00Tcm4TlvDq8ikWAM",
    length: "standard",
  });
  assert.ok(bare.ok);
  if (bare.ok) {
    assert.equal("model" in bare.value, false);
    assert.equal("voiceSettings" in bare.value, false);
  }
  // Model/voiceSettings are rejected on the local provider and on non-podcast kinds.
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      model: "eleven_v3",
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("short-video", {
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "brief",
      model: "eleven_v3",
    }).ok,
    false,
  );
  // Malformed model ids and out-of-range settings are rejected.
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
      model: "a/b",
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
      voiceSettings: { stability: 1.5 },
    }).ok,
    false,
  );
  for (const speed of [0.25, 4]) {
    assert.equal(
      validateResearchMediaRenderConfig("podcast", {
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        length: "standard",
        voiceSettings: { speed },
      }).ok,
      true,
      `REST speed ${speed} is accepted`,
    );
  }
  for (const speed of [0.249, 4.001]) {
    assert.equal(
      validateResearchMediaRenderConfig("podcast", {
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        length: "standard",
        voiceSettings: { speed },
      }).ok,
      false,
      `out-of-range REST speed ${speed} is rejected`,
    );
  }
});

test("podcast seed is ElevenLabs-only, podcast-only, and bounded", () => {
  const pinned = validateResearchMediaRenderConfig("podcast", {
    provider: "elevenlabs",
    voice: "21m00Tcm4TlvDq8ikWAM",
    length: "standard",
    seed: 20_260_817,
  });
  assert.ok(pinned.ok);
  if (pinned.ok) assert.equal(pinned.value.seed, 20_260_817);

  // An absent seed stays absent, so stored configs revalidate unchanged.
  const bare = validateResearchMediaRenderConfig("podcast", {
    provider: "elevenlabs",
    voice: "21m00Tcm4TlvDq8ikWAM",
    length: "standard",
  });
  assert.ok(bare.ok);
  if (bare.ok) assert.equal("seed" in bare.value, false);

  for (const seed of [0, 4_294_967_295]) {
    assert.equal(
      validateResearchMediaRenderConfig("podcast", {
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        length: "standard",
        seed,
      }).ok,
      true,
      `seed ${seed} is in range`,
    );
  }
  for (const seed of [-1, 1.5, 4_294_967_296, "7"]) {
    assert.equal(
      validateResearchMediaRenderConfig("podcast", {
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        length: "standard",
        seed,
      }).ok,
      false,
      `seed ${seed} is rejected`,
    );
  }
  assert.equal(
    validateResearchMediaRenderConfig("podcast", {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      seed: 7,
    }).ok,
    false,
  );
  assert.equal(
    validateResearchMediaRenderConfig("short-video", {
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "brief",
      seed: 7,
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
      kind: "podcast",
      script: [
        { id: "segment-1", text: "Welcome in.", speaker: "host" },
        { id: "segment-2", text: "A source-grounded finding.", speaker: "guest" },
      ],
    }),
  );
  assert.equal(
    isResearchGenerationContent({
      kind: "podcast",
      script: [{ id: "segment-1", text: "Narration.", speaker: "narrator" }],
    }),
    false,
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

// ── ElevenLabs podcast delivery direction (cave-sl7je) ───────────────────────

const BASE_PODCAST_CONFIG = {
  provider: "elevenlabs",
  voice: "21m00Tcm4TlvDq8ikWAM",
  length: "standard",
} as const;

test("delivery presets sit on the stability axis they claim to", () => {
  const stability = Object.fromEntries(
    ELEVENLABS_DELIVERY_PRESETS.map((preset) => [preset.id, preset.settings.stability]),
  );
  // Lower stability lets the model reset pitch between sentences; higher holds
  // one even reading. The ordering IS the meaning of the four names.
  assert.ok(
    stability.animated < stability.conversational,
    "animated is looser than conversational",
  );
  assert.ok(
    stability.conversational < stability.neutral,
    "conversational is looser than the baseline",
  );
  assert.ok(
    stability.neutral < stability.narration,
    "narration is steadier than the baseline",
  );
  // Neutral must be the untouched baseline, or "no direction" would silently
  // change how every existing render sounds.
  assert.deepEqual(
    elevenLabsDeliveryPreset("neutral")?.settings,
    DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  );
  for (const preset of ELEVENLABS_DELIVERY_PRESETS) {
    if (preset.id === "neutral") continue;
    assert.notDeepEqual(
      preset.settings,
      DEFAULT_ELEVENLABS_VOICE_SETTINGS,
      `${preset.id} directs something the baseline does not`,
    );
  }
  assert.equal(elevenLabsDeliveryPreset("nonexistent"), null);
});

test("every offered delivery and model is accepted by the stored render contract", () => {
  for (const preset of ELEVENLABS_DELIVERY_PRESETS) {
    const validated = validateResearchMediaRenderConfig("podcast", {
      ...BASE_PODCAST_CONFIG,
      voiceSettings: preset.settings,
    });
    assert.ok(validated.ok, `${preset.id} settings are in range`);
    if (validated.ok) {
      assert.deepEqual(validated.value.voiceSettings, preset.settings);
      // The review gate reads the stored settings back, so the round trip has
      // to name the same preset the author chose.
      assert.equal(
        describeElevenLabsVoiceSettings(validated.value.voiceSettings!),
        preset.label,
      );
    }
  }
  for (const option of ELEVENLABS_PODCAST_MODEL_OPTIONS) {
    assert.ok(
      validateResearchMediaRenderConfig("podcast", {
        ...BASE_PODCAST_CONFIG,
        model: option.id,
      }).ok,
      `${option.id} is a valid model id`,
    );
  }
});

test("settings off every preset are reported as custom, never mislabelled", () => {
  assert.equal(
    describeElevenLabsVoiceSettings({
      ...DEFAULT_ELEVENLABS_VOICE_SETTINGS,
      stability: 0.41,
    }),
    "Custom",
  );
  // A single differing field is enough — a near-match must not borrow a name,
  // and every field has to participate or one of them silently stops mattering.
  const base = elevenLabsDeliveryPreset("conversational")!.settings;
  const perturbed: Record<string, unknown>[] = [
    { stability: base.stability + 0.01 },
    { similarityBoost: base.similarityBoost + 0.01 },
    { style: base.style + 0.01 },
    { useSpeakerBoost: !base.useSpeakerBoost },
    { speed: base.speed + 0.01 },
  ];
  for (const change of perturbed) {
    assert.equal(
      describeElevenLabsVoiceSettings({ ...base, ...change }),
      "Custom",
      `${Object.keys(change)[0]} participates in the match`,
    );
  }
});

test("podcast direction is composed only where the contract accepts it", () => {
  const directed = {
    delivery: "conversational",
    model: "eleven_v3",
    seed: "20260823",
  } as const;
  assert.deepEqual(
    elevenLabsPodcastDirection({
      kind: "podcast",
      provider: "elevenlabs",
      ...directed,
    }),
    {
      model: "eleven_v3",
      voiceSettings: elevenLabsDeliveryPreset("conversational")!.settings,
      seed: 20_260_823,
    },
  );
  // Local podcasts and every non-podcast kind must contribute nothing: the
  // contract rejects these three fields there, so composing them would make
  // the create request 400 rather than degrade.
  assert.deepEqual(
    elevenLabsPodcastDirection({ kind: "podcast", provider: "local", ...directed }),
    {},
  );
  for (const kind of ["short-video", "long-video", "blog"] as const) {
    assert.deepEqual(
      elevenLabsPodcastDirection({ kind, provider: "elevenlabs", ...directed }),
      {},
      `${kind} carries no podcast direction`,
    );
  }
});

test("undirected podcast fields are omitted rather than restated", () => {
  // The whole point: a config nobody directed must be byte-identical to what
  // the Studio sent before delivery became selectable.
  assert.deepEqual(
    elevenLabsPodcastDirection({
      kind: "podcast",
      provider: "elevenlabs",
      delivery: "neutral",
      model: "",
      seed: "",
    }),
    {},
  );
  const validated = validateResearchMediaRenderConfig("podcast", {
    ...BASE_PODCAST_CONFIG,
    ...elevenLabsPodcastDirection({
      kind: "podcast",
      provider: "elevenlabs",
      delivery: "neutral",
      model: "",
      seed: "",
    }),
  });
  assert.ok(validated.ok);
  if (validated.ok) {
    assert.equal("model" in validated.value, false);
    assert.equal("voiceSettings" in validated.value, false);
    assert.equal("seed" in validated.value, false);
  }
});

test("a seed the contract would reject never reaches the render config", () => {
  for (const seed of ["abc", "-1", "1.5", "4294967296", " ", "1e400"]) {
    const direction = elevenLabsPodcastDirection({
      kind: "podcast",
      provider: "elevenlabs",
      delivery: "neutral",
      model: "",
      seed,
    });
    assert.equal("seed" in direction, false, `seed ${JSON.stringify(seed)} is dropped`);
  }
  for (const [seed, expected] of [["0", 0], ["4294967295", 4_294_967_295], [" 42 ", 42]] as const) {
    assert.deepEqual(
      elevenLabsPodcastDirection({
        kind: "podcast",
        provider: "elevenlabs",
        delivery: "neutral",
        model: "",
        seed,
      }),
      { seed: expected },
    );
  }
});

test("an unrecognized model id is dropped instead of failing the create", () => {
  assert.deepEqual(
    elevenLabsPodcastDirection({
      kind: "podcast",
      provider: "elevenlabs",
      delivery: "neutral",
      model: "Eleven V3!",
      seed: "",
    }),
    {},
  );
});
