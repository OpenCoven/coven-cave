// @ts-nocheck
/**
 * Behavioural cover for the Studio's ElevenLabs podcast delivery controls
 * (cave-sl7je). These assertions drive the rendered dialog — selecting a
 * delivery preset, typing a seed, reading the review gate — rather than
 * matching the component's source text, so deleting a control fails them.
 */
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/use-focus-trap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-focus-trap")>()),
  useFocusTrap: () => {},
}));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce: () => {} }),
}));
vi.mock("@/components/message-bubble", () => ({
  MarkdownBlock: ({ text }: { text?: string }) => createElement("div", null, text),
}));
vi.mock("@/components/role-surfaces/podcast-transcript", () => ({
  PodcastTranscript: () => createElement("div", { "data-transcript": true }),
}));
vi.mock("@/components/ui/authed-image", () => ({
  AuthedImage: () => createElement("span", { "aria-hidden": true }),
}));
vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: ({ iso }: { iso?: string }) => createElement("time", null, iso),
}));
vi.mock("@/lib/clipboard", () => ({ copyText: async () => true }));
vi.mock("@/lib/research-media-client", () => ({
  useResearchMediaUrl: () => null,
}));

import {
  GenerationConfigModal,
  GenerationReviewModal,
} from "./research-studio-modals";
import { StandardSelect } from "@/components/ui/select";
import { elevenLabsDeliveryPreset } from "@/lib/voice/elevenlabs-shared";
import { createPodcastPreviewController } from "./research-podcast-preview";
import { readPodcastPreferences, savePodcastPreferences } from "./research-podcast-preferences";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const readiness = {
  providers: {
    local: {
      ready: true,
      voices: [{ id: "piper-lessac-medium", name: "Lessac", engine: "piper" }],
    },
    elevenlabs: { ready: true, defaultVoiceId: "21m00Tcm4TlvDq8ikWAM" },
  },
  ffmpeg: { ready: true },
  podcast: { ready: true },
  shortVideo: { ready: true },
  longVideo: { ready: true },
};

function renderConfig(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {
    delivery: [],
    guestVoice: [],
    model: [],
    seed: [],
    voice: [],
  };
  const props = {
    kind: "podcast",
    sources: [{ id: "m-1", title: "The identity layer gap" }],
    selectedSourceId: "m-1",
    onSelectSource: () => {},
    directions: "",
    onDirectionsChange: () => {},
    readiness,
    mediaProvider: "elevenlabs",
    onMediaProviderChange: () => {},
    mediaVoice: "21m00Tcm4TlvDq8ikWAM",
    onMediaVoiceChange: (value: unknown) => calls.voice.push(value),
    mediaGuestVoice: "",
    onMediaGuestVoiceChange: (value: unknown) => calls.guestVoice.push(value),
    elevenLabsCatalog: {
      status: "ready",
      voices: [
        { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
        { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", category: "premade" },
      ],
      models: [],
    },
    onRetryElevenLabsCatalog: () => {},
    mediaStyle: "breakdown",
    onMediaStyleChange: () => {},
    mediaLength: "standard",
    onMediaLengthChange: () => {},
    mediaDelivery: "neutral",
    onMediaDeliveryChange: (value: unknown) => calls.delivery.push(value),
    mediaModel: "",
    onMediaModelChange: (value: unknown) => calls.model.push(value),
    mediaSeed: "",
    onMediaSeedChange: (value: unknown) => calls.seed.push(value),
    error: null,
    creating: false,
    onSubmit: () => {},
    onClose: () => {},
    ...overrides,
  };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(GenerationConfigModal, props));
  });
  return { renderer: renderer!, calls, props };
}

/** Find a rendered host element by its DOM id, or null when absent. */
function byId(renderer: ReturnType<typeof create>, id: string) {
  return (
    renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.id === id,
      { deep: true },
    )[0] ?? null
  );
}

/**
 * The design system forbids a native <select>, so the two dropdowns are
 * StandardSelect. Reach them by the primitive's own contract — its `options`
 * and `onChange` — rather than by the popover markup it happens to render.
 */
function selectById(renderer: ReturnType<typeof create>, id: string) {
  return (
    renderer.root.findAll(
      (node) => node.type === StandardSelect && node.props.id === id,
      { deep: true },
    )[0] ?? null
  );
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const children = (node as { props?: { children?: unknown } }).props?.children;
  return children === undefined ? "" : textOf(children);
}

const DIRECTION_IDS = [
  "research-studio-config-delivery",
  "research-studio-config-model",
  "research-studio-config-seed",
];

describe("Studio podcast delivery controls", () => {
  test("use ElevenLabs dropdowns for both podcast voices", () => {
    const { renderer, calls } = renderConfig();
    const host = selectById(
      renderer,
      "research-studio-config-elevenlabs-voice",
    );
    const guest = selectById(
      renderer,
      "research-studio-config-guest-voice",
    );

    expect(host).not.toBeNull();
    expect(guest).not.toBeNull();
    expect(
      host.props.options.map((option: { value: string }) => option.value),
    ).toEqual(["21m00Tcm4TlvDq8ikWAM", "AZnzlk1XvdvUeBnXmlld"]);
    expect(
      guest.props.options.map((option: { value: string }) => option.value),
    ).toEqual(["", "21m00Tcm4TlvDq8ikWAM", "AZnzlk1XvdvUeBnXmlld"]);

    act(() => {
      host.props.onChange("AZnzlk1XvdvUeBnXmlld");
      guest.props.onChange("21m00Tcm4TlvDq8ikWAM");
    });
    expect(calls.voice).toEqual(["AZnzlk1XvdvUeBnXmlld"]);
    expect(calls.guestVoice).toEqual(["21m00Tcm4TlvDq8ikWAM"]);
  });

  test("block drafting while the ElevenLabs voice catalog is unavailable", () => {
    const loading = renderConfig({
      elevenLabsCatalog: { status: "loading" },
    });

    expect(
      selectById(
        loading.renderer,
        "research-studio-config-elevenlabs-voice",
      ).props.disabled,
    ).toBe(true);
    expect(
      loading.renderer.root
        .findAllByType("button")
        .find((button) => textOf(button).includes("Draft podcast")).props
        .disabled,
    ).toBe(true);

    const failed = renderConfig({
      elevenLabsCatalog: {
        status: "error",
        code: "network_error",
        message: "Couldn’t reach ElevenLabs. Try again.",
      },
    });
    expect(
      textOf(byId(failed.renderer, "research-studio-config-media-error")),
    ).toContain("Couldn’t reach ElevenLabs");
    expect(
      failed.renderer.root
        .findAllByType("button")
        .some((button) => textOf(button) === "Retry voices"),
    ).toBe(true);
  });

  test("associate invalid voice dropdowns with the media error", () => {
    const { renderer } = renderConfig({
      elevenLabsCatalog: {
        status: "error",
        message: "Voice catalog unavailable.",
      },
    });

    for (const id of [
      "research-studio-config-elevenlabs-voice",
      "research-studio-config-guest-voice",
    ]) {
      const trigger = byId(renderer, id);
      expect(trigger.props["aria-invalid"]).toBe(true);
      expect(trigger.props["aria-errormessage"]).toBe(
        "research-studio-config-media-error",
      );
      expect(selectById(renderer, id).props.showCaret).toBe(true);
    }
  });

  test("appear for an ElevenLabs podcast", () => {
    const { renderer } = renderConfig();
    for (const id of DIRECTION_IDS) {
      expect(byId(renderer, id), id).not.toBeNull();
    }
    // Every preset is offered, in the order the shared module defines.
    expect(
      selectById(renderer, "research-studio-config-delivery").props.options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(["neutral", "conversational", "animated", "narration"]);
    // The model list keeps an explicit "use the pipeline default" entry, so
    // choosing a model is never a one-way door in the dialog.
    expect(
      selectById(renderer, "research-studio-config-model").props.options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(["", "eleven_multilingual_v2", "eleven_v3", "eleven_turbo_v2_5"]);
  });

  test("stay hidden where the render contract would reject them", () => {
    // Local synthesis takes no ElevenLabs settings…
    const local = renderConfig({
      mediaProvider: "local",
      mediaVoice: "piper-lessac-medium",
    });
    for (const id of DIRECTION_IDS) {
      expect(byId(local.renderer, id), `local ${id}`).toBeNull();
    }
    // …and neither do the video kinds.
    const video = renderConfig({ kind: "short-video", mediaLength: "standard" });
    for (const id of DIRECTION_IDS) {
      expect(byId(video.renderer, id), `short-video ${id}`).toBeNull();
    }
  });

  test("report the chosen direction back to the Studio", () => {
    const { renderer, calls } = renderConfig();
    act(() => {
      selectById(renderer, "research-studio-config-delivery").props.onChange(
        "animated",
      );
      selectById(renderer, "research-studio-config-model").props.onChange(
        "eleven_v3",
      );
      byId(renderer, "research-studio-config-seed").props.onChange({
        target: { value: "20260823" },
      });
    });
    expect(calls.delivery).toEqual(["animated"]);
    expect(calls.model).toEqual(["eleven_v3"]);
    expect(calls.seed).toEqual(["20260823"]);
  });

  test("explain the selected preset rather than a fixed blurb", () => {
    for (const id of ["neutral", "conversational", "animated", "narration"] as const) {
      const { renderer } = renderConfig({ mediaDelivery: id });
      expect(textOf(byId(renderer, "research-studio-config-delivery-help"))).toBe(
        elevenLabsDeliveryPreset(id)!.hint,
      );
    }
  });

  test("block the draft on a seed the render contract would reject", () => {
    const bad = renderConfig({ mediaSeed: "4294967296" });
    const error = byId(bad.renderer, "research-studio-config-media-error");
    expect(error).not.toBeNull();
    expect(textOf(error)).toContain("Seed must be a whole number");
    const submit = bad.renderer.root
      .findAllByType("button")
      .find((button) => textOf(button).includes("Draft podcast"));
    expect(submit.props.disabled).toBe(true);

    const good = renderConfig({ mediaSeed: "4294967295" });
    expect(byId(good.renderer, "research-studio-config-media-error")).toBeNull();
    expect(
      good.renderer.root
        .findAllByType("button")
        .find((button) => textOf(button).includes("Draft podcast")).props.disabled,
    ).toBe(false);
  });
});

describe("Studio review gate", () => {
  function renderReview(renderConfigValue: Record<string, unknown>) {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        createElement(GenerationReviewModal, {
          generation: {
            id: "gen-1",
            familiarId: "nova",
            kind: "podcast",
            status: "draft",
            sourceMissionId: "m-1",
            sourceTitle: "The identity layer gap",
            createdAt: "2026-08-23T00:00:00.000Z",
            renderConfig: renderConfigValue,
          },
          rendering: false,
          error: null,
          onRender: () => {},
          onClose: () => {},
        }),
      );
    });
    const rows = renderer!.root
      .findAllByType("dt")
      .map((term, index) => [
        textOf(term),
        textOf(renderer!.root.findAllByType("dd")[index]),
      ]);
    return Object.fromEntries(rows);
  }

  test("names the delivery, model, and seed frozen on the draft", () => {
    const rows = renderReview({
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
      model: "eleven_v3",
      voiceSettings: elevenLabsDeliveryPreset("animated")!.settings,
      seed: 20_260_823,
    });
    expect(rows.Delivery).toBe("Animated");
    expect(rows.Model).toBe("v3 · most expressive");
    expect(rows.Seed).toBe("20260823 · best effort, not deterministic");
  });

  test("says nothing about direction an undirected render never carried", () => {
    const rows = renderReview({
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
    });
    expect(rows.Delivery).toBeUndefined();
    expect(rows.Model).toBeUndefined();
    expect(rows.Seed).toBeUndefined();
    expect(rows.Voice).toBe("21m00Tcm4TlvDq8ikWAM (catalog name unavailable)");
  });

  describe("Podcast configuration honesty", () => {
    test("keeps advanced controls collapsed and exposes named local choices with carets", () => {
      const hosted = renderConfig();
      expect(hosted.renderer.root.findAllByType("details").every((details) => details.props.open === undefined)).toBe(true);
      expect(hosted.renderer.root.findAllByType("summary").map(textOf).join(" ")).toContain("Advanced voice settings");
      const local = renderConfig({ mediaProvider: "local", mediaVoice: "piper-lessac-medium" });
      const host = selectById(local.renderer, "research-studio-config-local-voice");
      expect(host.props.options[0].label).toBe("Lessac");
      expect(host.props.showCaret).toBe(true);
      expect(local.renderer.root.findAllByType("p").map(textOf).join(" ")).toContain("will not switch automatically");
      expect(textOf(byId(local.renderer, "research-studio-config-guest-voice-help"))).toContain("Host and guest use the same voice");
    });

    test("never manufactures ready catalog options for stale host or guest ids", () => {
      for (const overrides of [{ mediaVoice: "stalevoice123" }, { mediaGuestVoice: "stalevoice123" }]) {
        const { renderer } = renderConfig(overrides);
        expect(textOf(byId(renderer, "research-studio-config-media-error"))).toContain("unavailable");
        expect(selectById(renderer, "research-studio-config-elevenlabs-voice").props.options.some((option) => option.value === "stalevoice123")).toBe(false);
        expect(renderer.root.findAllByType("button").find((button) => textOf(button).includes("Draft podcast")).props.disabled).toBe(true);
      }
      const empty = renderConfig({ elevenLabsCatalog: { status: "ready", voices: [], models: [] } });
      expect(textOf(byId(empty.renderer, "research-studio-config-media-error"))).toContain("No ElevenLabs voices are available");
      expect(empty.renderer.root.findAllByType("button").some((button) => textOf(button) === "Retry voices")).toBe(true);
    });

    test("runtime readiness hints take precedence over stale installed voice choices", () => {
      const hint = "Piper runtime is missing. Install the Piper runtime, then retry.";
      const retry = vi.fn();
      const { renderer } = renderConfig({
        mediaProvider: "local", mediaVoice: "piper-lessac-medium",
        onRetryReadiness: retry,
        readiness: {
          ...readiness,
          providers: {
            ...readiness.providers,
            local: { ...readiness.providers.local, ready: false, hint },
          },
        },
      });
      expect(textOf(byId(renderer, "research-studio-config-media-error"))).toBe(hint);
      expect(textOf(byId(renderer, "research-studio-config-voice-help"))).toBe(hint);
      expect(selectById(renderer, "research-studio-config-provider").props.options[0].detail).toBe(hint);
      expect(renderer.root.findAllByType("button").find((button) => textOf(button) === "Preview host voice").props.disabled).toBe(true);
      expect(renderer.root.findAllByType("button").find((button) => textOf(button).includes("Draft podcast")).props.disabled).toBe(true);
      act(() => renderer.root.findAllByType("button").find((button) => textOf(button) === "Retry local readiness").props.onClick());
      expect(retry).toHaveBeenCalledOnce();
    });

    test("provider switch resets guest to a voice from the new catalog", () => {
      const { renderer, calls } = renderConfig({ mediaGuestVoice: "AZnzlk1XvdvUeBnXmlld" });
      act(() => selectById(renderer, "research-studio-config-provider").props.onChange("local"));
      expect(calls.voice).toEqual(["piper-lessac-medium"]);
      expect(calls.guestVoice).toEqual([""]);
    });

    test("restricts unavailable account models and incompatible v3 directions", () => {
      const { renderer } = renderConfig({
        mediaModel: "eleven_v3",
        mediaDelivery: "neutral",
        elevenLabsCatalog: {
          status: "ready", voices: [{ id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" }],
          models: [{ id: "eleven_v3", name: "Eleven v3" }],
        },
      });
      expect(selectById(renderer, "research-studio-config-model").props.options.map((option) => option.value)).toEqual(["", "eleven_v3"]);
      expect(selectById(renderer, "research-studio-config-model").props.options[0].disabled).toBe(true);
      expect(selectById(renderer, "research-studio-config-delivery").props.options.map((option) => option.value)).toEqual(["neutral"]);
    });

    test("changing to v3 requires explicit delivery repair rather than rewriting the selected preset", () => {
      const { renderer, calls, props } = renderConfig({ mediaDelivery: "conversational" });
      act(() => selectById(renderer, "research-studio-config-model").props.onChange("eleven_v3"));
      expect(calls.model).toEqual(["eleven_v3"]);
      expect(calls.delivery).toEqual([]);
      act(() => renderer.update(createElement(GenerationConfigModal, { ...props, mediaModel: "eleven_v3" })));
      expect(textOf(byId(renderer, "research-studio-config-media-error"))).toMatch(/Choose Neutral delivery or Multilingual v2/);
      expect(renderer.root.findAllByType("button").find((button) => textOf(button).includes("Draft podcast")).props.disabled).toBe(true);
      act(() => renderer.update(createElement(GenerationConfigModal, { ...props, mediaModel: "eleven_v3", mediaDelivery: "neutral" })));
      expect(byId(renderer, "research-studio-config-media-error")).toBeNull();
    });
  });

  function previewFixture() {
    const states = [];
    const audio = {
      play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
      src: "", onended: null, onerror: null,
    };
    const dependencies = {
      fetch: vi.fn(async () => new Response(new Blob(["wave"]), { headers: { "content-type": "audio/wav" } })),
      audio: vi.fn(() => audio),
      createUrl: vi.fn(() => "blob:preview"),
      revokeUrl: vi.fn(),
    };
    const controller = createPodcastPreviewController((state) => states.push(state), dependencies);
    return { controller, dependencies, audio, states };
  }
  const previewRequest = {
    provider: "elevenlabs" as const, voice: "21m00Tcm4TlvDq8ikWAM",
    model: "eleven_multilingual_v2",
    voiceSettings: elevenLabsDeliveryPreset("conversational")!.settings, seed: 42,
  };

  describe("Podcast audition lifecycle", () => {
    test("posts the actual voice direction without source text and releases ended audio", async () => {
      const { controller, dependencies, audio, states } = previewFixture();
      await controller.play("host", previewRequest);
      const [path, init] = dependencies.fetch.mock.calls[0];
      expect(path).toBe("/api/research/generations/preview");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual(previewRequest);
      expect(audio.src).toBe("blob:preview");
      expect(states.at(-1).status).toBe("playing");
      audio.onended();
      expect(audio.pause).toHaveBeenCalled();
      expect(audio.removeAttribute).toHaveBeenCalledWith("src");
      expect(dependencies.revokeUrl).toHaveBeenCalledWith("blob:preview");
      expect(states.at(-1).status).toBe("idle");
    });

    test("stops and revokes the host before playing a guest, then stops on close", async () => {
      const { controller, dependencies, audio } = previewFixture();
      await controller.play("host", previewRequest);
      await controller.play("guest", { ...previewRequest, voice: "AZnzlk1XvdvUeBnXmlld" });
      expect(audio.pause).toHaveBeenCalledTimes(1);
      expect(dependencies.revokeUrl).toHaveBeenCalledTimes(1);
      expect(JSON.parse(dependencies.fetch.mock.calls[1][1].body).voice).toBe("AZnzlk1XvdvUeBnXmlld");
      controller.stop(false);
      expect(audio.pause).toHaveBeenCalledTimes(2);
      expect(dependencies.revokeUrl).toHaveBeenCalledTimes(2);
    });

    test("cancels superseded pending requests even when fetch ignores abort", async () => {
      const { controller, dependencies, audio } = previewFixture();
      let resolve;
      dependencies.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      const pending = controller.play("host", previewRequest);
      const signal = dependencies.fetch.mock.calls[0][1].signal;
      await controller.play("guest", { ...previewRequest, voice: "AZnzlk1XvdvUeBnXmlld" });
      expect(signal.aborted).toBe(true);
      resolve(new Response(new Blob(["late wave"]), { headers: { "content-type": "audio/wav" } }));
      await pending;
      expect(audio.play).toHaveBeenCalledTimes(1);
      controller.stop();
    });

    test("rejects late blob conversion and late play promises after cancellation", async () => {
      const fixture = previewFixture();
      let resolveBlob;
      fixture.dependencies.fetch.mockResolvedValueOnce({
        ok: true, headers: new Headers({ "content-type": "audio/wav" }),
        blob: () => new Promise((done) => { resolveBlob = done; }),
      });
      const pending = fixture.controller.play("host", previewRequest);
      await Promise.resolve();
      fixture.controller.stop(false);
      resolveBlob(new Blob(["late"]));
      await pending;
      expect(fixture.dependencies.createUrl).not.toHaveBeenCalled();
      let resolvePlay;
      fixture.audio.play.mockImplementationOnce(() => new Promise((done) => { resolvePlay = done; }));
      const playing = fixture.controller.play("host", previewRequest);
      await vi.waitFor(() => expect(fixture.audio.play).toHaveBeenCalledTimes(1));
      fixture.controller.stop();
      resolvePlay();
      await playing;
      expect(fixture.states.at(-1).status).toBe("idle");
      expect(fixture.dependencies.revokeUrl).toHaveBeenCalledTimes(1);
    });

    test("autoplay failure releases the blob and allows a new explicit retry", async () => {
      const { controller, dependencies, audio, states } = previewFixture();
      audio.play.mockRejectedValueOnce(new Error("Playback requires another click."));
      await controller.play("host", previewRequest);
      expect(states.at(-1)).toMatchObject({ status: "error", error: "Playback requires another click." });
      expect(dependencies.revokeUrl).toHaveBeenCalledTimes(1);
      await controller.play("host", previewRequest);
      expect(states.at(-1).status).toBe("playing");
      controller.stop();
    });

    test("JSON failures and empty audio never reach playback", async () => {
      for (const response of [
        Response.json({ ok: false, error: "Configure your voice provider, then retry." }, { status: 503 }),
        new Response(new Blob([]), { headers: { "content-type": "audio/wav" } }),
      ]) {
        const { controller, dependencies, audio, states } = previewFixture();
        dependencies.fetch.mockResolvedValueOnce(response);
        await controller.play("host", previewRequest);
        expect(states.at(-1).status).toBe("error");
        expect(audio.play).not.toHaveBeenCalled();
      }
    });

    test("selection changes and modal unmount abort the component's real fetch", async () => {
      const requests = [];
      vi.stubGlobal("fetch", vi.fn((path, init) => new Promise(() => { requests.push({ path, init }); })));
      const { renderer, props } = renderConfig({ mediaDelivery: "conversational" });
      const clickPreview = () => act(() => renderer.root.findAllByType("button").find((button) => textOf(button) === "Preview host voice").props.onClick());
      for (const change of [
        { mediaVoice: "AZnzlk1XvdvUeBnXmlld" }, { mediaGuestVoice: "21m00Tcm4TlvDq8ikWAM" },
        { mediaModel: "eleven_turbo_v2_5" }, { mediaDelivery: "animated" }, { mediaSeed: "7" },
        { mediaStyle: "interview" }, { mediaProvider: "local", mediaVoice: "piper-lessac-medium", mediaGuestVoice: "" },
      ]) {
        clickPreview();
        const request = requests.at(-1);
        Object.assign(props, change);
        act(() => renderer.update(createElement(GenerationConfigModal, props)));
        expect(request.init.signal.aborted).toBe(true);
      }
      clickPreview();
      act(() => renderer.unmount());
      expect(requests.at(-1).init.signal.aborted).toBe(true);
      vi.unstubAllGlobals();
    });
  });

  describe("Podcast preferences", () => {
    const preferences = {
      version: 1, provider: "local", voice: "piper-lessac-medium", guestVoice: "",
      style: "breakdown", length: "standard", delivery: "conversational", model: "", seed: "",
    };
    test("uses a versioned per-familiar namespace without changing stale choices", () => {
      const items = new Map();
      const storage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
      expect(savePodcastPreferences(storage, "nova", preferences)).toBe(true);
      expect(readPodcastPreferences(storage, "nova")).toEqual(preferences);
      expect(readPodcastPreferences(storage, "sage")).toBeNull();
      expect([...items.keys()]).toEqual(["cave:research-podcast:v1:nova"]);
    });
    test("rejects malformed or future storage and tolerates denied storage", () => {
      for (const value of ["broken", JSON.stringify({ ...preferences, version: 2 }), JSON.stringify({ ...preferences, seed: "-1" }), JSON.stringify({ ...preferences, provider: "other" })]) {
        expect(readPodcastPreferences({ getItem: () => value }, "nova")).toBeNull();
      }
      expect(readPodcastPreferences({ getItem: () => { throw new Error("denied"); } }, "nova")).toBeNull();
      expect(savePodcastPreferences({ setItem: () => { throw new Error("full"); } }, "nova", preferences)).toBe(false);
    });
  });

  test("refuses to name a preset for settings that are not one", () => {
    const rows = renderReview({
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      length: "standard",
      voiceSettings: {
        ...elevenLabsDeliveryPreset("animated")!.settings,
        speed: 1.2,
      },
    });
    expect(rows.Delivery).toBe("Custom");
  });
});
