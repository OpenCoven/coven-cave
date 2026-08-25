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

vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => {} }));
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
  return { renderer: renderer!, calls };
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
        .find((button) => textOf(button).includes("Draft for review")).props
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
      expect(selectById(renderer, id).props.showCaret).toBe(false);
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
      .find((button) => textOf(button).includes("Draft for review"));
    expect(submit.props.disabled).toBe(true);

    const good = renderConfig({ mediaSeed: "4294967295" });
    expect(byId(good.renderer, "research-studio-config-media-error")).toBeNull();
    expect(
      good.renderer.root
        .findAllByType("button")
        .find((button) => textOf(button).includes("Draft for review")).props.disabled,
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
    expect(rows.Model).toBe("eleven_v3");
    expect(rows.Seed).toBe("20260823");
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
    expect(rows.Voice).toBe("21m00Tcm4TlvDq8ikWAM");
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
