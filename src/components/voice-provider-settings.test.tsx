// @ts-nocheck
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const preferences = vi.hoisted(() => ({
  voice: { defaultProvider: "", defaultModel: "", defaultVoice: "" },
}));
const updateAppPreferences = vi.hoisted(() => vi.fn());
const announce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app-preferences", () => ({
  useAppPreferences: () => ({ voice: preferences.voice }),
  updateAppPreferences,
}));

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

vi.mock("@/components/ui/settings-group", () => ({
  SettingsGroup: ({ label, description, meta, action, children }) =>
    createElement(
      "section",
      { "aria-label": label },
      createElement("h2", null, label),
      description ? createElement("p", null, description) : null,
      meta ? createElement("span", null, meta) : null,
      action,
      children,
    ),
}));

vi.mock("@/components/ui/select", () => ({
  StandardSelect: ({ label, value, onChange, options, disabled, id, "aria-describedby": ariaDescribedBy }) => {
    const flattened = options.flatMap((entry) =>
      Array.isArray(entry.options) ? entry.options : [entry],
    );
    return createElement(
      "select",
      {
        "aria-label": label,
        "aria-describedby": ariaDescribedBy,
        id,
        value,
        disabled,
        onChange: (event) => onChange(event.target.value),
      },
      flattened.map((option) =>
        createElement(
          "option",
          { key: option.value, value: option.value, disabled: option.disabled },
          `${option.label}${option.detail ? ` — ${option.detail}` : ""}`,
        ),
      ),
    );
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, loading, leadingIcon: _leadingIcon, ...props }) =>
    createElement("button", { ...props, disabled: props.disabled || loading, "aria-busy": loading || undefined }, children),
}));

vi.mock("@/components/ui/error-state", () => ({
  ErrorState: ({ headline, subtitle, actions, live = true }) =>
    createElement("div", { role: live ? "alert" : undefined }, headline, subtitle, actions),
}));

vi.mock("@/components/ui/skeleton", () => ({
  SkeletonRows: () => createElement("div", { role: "status" }, "Loading"),
}));

import { VoiceProviderSettings } from "./voice-provider-settings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const credentialPayload = {
  ok: true,
  credentials: [
    { key: "ELEVENLABS_API_KEY", status: "encrypted", hasValue: true, storage: "encrypted", source: "vault" },
    { key: "OPENAI_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
  ],
};

const elevenPayload = {
  ok: true,
  voices: [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
    { id: "OpaqueVoice123", name: "Morgan", category: "cloned" },
  ],
  models: [
    { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
    { id: "eleven_flash_v2_5", name: "Flash v2.5" },
  ],
};

const localPayload = {
  ok: true,
  tts: [],
  ttsVoices: [
    { id: "piper-en-us-lessac-medium", name: "Lessac", engine: "piper", ready: true, verified: true },
    { id: "not-ready", name: "Not ready", engine: "piper", ready: false, verified: false },
  ],
  runtimes: {
    piper: { available: true },
    kokoro: { available: false, hint: "Kokoro is not installed." },
  },
};

function installFetch(overrides = {}) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const override = overrides[url];
    if (override) return override(url, init);
    if (url === "/api/vault" && init?.method === "POST") return jsonResponse({ ok: true });
    if (url === "/api/voice/credential-status") return jsonResponse(credentialPayload);
    if (url === "/api/voice/elevenlabs/catalog") return jsonResponse(elevenPayload);
    if (url === "/api/voice/engines") return jsonResponse(localPayload);
    if (url.startsWith("/api/voice/preview?voice=")) {
      return new Response(new Blob(["audio"]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

async function renderSettings(localSpeechSettings?: React.ReactNode): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<VoiceProviderSettings localSpeechSettings={localSpeechSettings} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function byLabel(renderer: ReactTestRenderer, type: string, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === type && node.props["aria-label"] === label,
  );
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && node.children.join("") === label,
  );
}

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let createdUrls: string[];
let revokedUrls: string[];

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  preferences.voice = { defaultProvider: "", defaultModel: "", defaultVoice: "" };
  updateAppPreferences.mockReset();
  announce.mockReset();
  installFetch();
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  createdUrls = [];
  revokedUrls = [];
  let nextUrl = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => {
      const value = `blob:voice-${++nextUrl}`;
      createdUrls.push(value);
      return value;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn((value: string) => revokedUrls.push(value)),
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: vi.fn(function MockAudio(src: string) {
      return { src, play, pause, currentTime: 0, onended: null };
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VoiceProviderSettings", () => {
  test("renders provider groups in the approved ownership order", async () => {
    const renderer = await renderSettings(
      createElement("section", { "aria-label": "Local speech" }),
    );
    expect(
      renderer.root
        .findAll((node) => node.type === "section" && node.props["aria-label"])
        .map((node) => node.props["aria-label"]),
    ).toEqual([
      "Default for new familiars",
      "ElevenLabs",
      "OpenAI Realtime",
      "Local speech",
      "Familiar brain",
      "Gemini Live",
    ]);
  });

  test("renders provider choices in catalog order, excludes Gemini, and writes complete defaults", async () => {
    const renderer = await renderSettings();
    const provider = byLabel(renderer, "select", "Default voice provider");
    expect(provider.findAllByType("option").map((option) => option.props.value)).toEqual([
      "",
      "familiar",
      "elevenlabs",
      "openai",
      "local",
    ]);
    expect(provider.findAllByType("option").map((option) => option.children.join(""))).not.toContain("Gemini Live");
    expect(text(renderer)).toContain("Gemini Live");
    expect(text(renderer)).toContain("isn’t available yet");

    await act(async () => provider.props.onChange({ target: { value: "openai" } }));
    expect(updateAppPreferences).toHaveBeenLastCalledWith({
      voice: { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "alloy" },
    });
    expect(announce).toHaveBeenLastCalledWith("Default voice provider set to OpenAI Realtime.", "polite");

    await act(async () => provider.props.onChange({ target: { value: "" } }));
    expect(updateAppPreferences).toHaveBeenLastCalledWith({
      voice: { defaultProvider: "", defaultModel: "", defaultVoice: "" },
    });
  });

  test("preserves stored opaque ElevenLabs ids and exposes editable fallbacks when the catalog fails", async () => {
    preferences.voice = {
      defaultProvider: "elevenlabs",
      defaultModel: "saved-model-opaque",
      defaultVoice: "SavedVoice999",
    };
    const renderer = await renderSettings();
    expect(byLabel(renderer, "select", "ElevenLabs model").findAllByType("option")[0].children.join(""))
      .toContain("Saved model ID");
    expect(byLabel(renderer, "select", "ElevenLabs voice").findAllByType("option")[0].children.join(""))
      .toContain("Saved voice ID");
    expect(text(renderer)).toContain("Morgan");
    expect(text(renderer)).toContain("Turbo v2.5");

    await act(async () => renderer.unmount());
    installFetch({
      "/api/voice/elevenlabs/catalog": async () => jsonResponse({ ok: false, error: "elevenlabs_unreachable", hint: "unsafe provider prose" }, 502),
    });
    const failed = await renderSettings();
    expect(text(failed)).toContain("Couldn't reach ElevenLabs");
    expect(text(failed)).not.toContain("unsafe provider prose");
    expect(byLabel(failed, "input", "ElevenLabs model ID").props.value).toBe("saved-model-opaque");
    expect(byLabel(failed, "input", "ElevenLabs voice ID").props.value).toBe("SavedVoice999");
    expect(failed.root.findAll((node) => node.type === "button" && node.children.join("") === "Retry").length).toBeGreaterThan(0);
  });

  test("bounds provider-ledger catalog names while keeping exact totals", async () => {
    const voices = Array.from({ length: 100 }, (_, index) => ({
      id: `Voice${String(index).padStart(8, "0")}`,
      name: `Catalog voice ${index}`,
      category: "saved",
    }));
    const models = Array.from({ length: 8 }, (_, index) => ({
      id: `catalog_model_${index}`,
      name: `Catalog model ${index}`,
    }));
    installFetch({
      "/api/voice/elevenlabs/catalog": async () => jsonResponse({ ok: true, voices, models }),
    });
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("100 voices available");
    expect(text(renderer)).toContain("Catalog voice 0");
    expect(text(renderer)).toContain("95 more");
    expect(text(renderer)).not.toContain("Catalog voice 99");
    expect(text(renderer)).toContain("8 models available");
    expect(text(renderer)).toContain("3 more");
    expect(text(renderer)).not.toContain("Catalog model 7");
  });

  test("treats Vault failure as an error and replacement stays blank, exact, secret-free, and refreshes state/catalog", async () => {
    installFetch({
      "/api/voice/credential-status": async () => jsonResponse({ ok: false, error: "raw-secret" }, 500),
    });
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("Couldn't load voice credential status");
    expect(text(renderer)).not.toContain("raw-secret");

    const elevenGroup = renderer.root.find(
      (node) => node.type === "section" && node.props["aria-label"] === "ElevenLabs",
    );
    await act(async () => elevenGroup.findAllByType("button").find((node) => node.children.join("") === "Replace key")!.props.onClick());
    const secretInput = byLabel(renderer, "input", "ElevenLabs API key");
    expect(secretInput.props.type).toBe("password");
    expect(secretInput.props.value).toBe("");
    expect(secretInput.props.autoComplete).toBe("new-password");

    await act(async () => secretInput.props.onChange({ target: { value: "  xi-super-secret  " } }));
    await act(async () => button(renderer, "Save key").props.onClick());
    const posts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("/api/vault");
    expect(JSON.parse(posts[0][1].body)).toEqual({
      key: "ELEVENLABS_API_KEY",
      storage: "encrypted",
      value: "xi-super-secret",
    });
    expect(text(renderer)).not.toContain("xi-super-secret");
    expect(announce).toHaveBeenCalledWith("ElevenLabs key saved.", "polite");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === "/api/voice/credential-status").length).toBeGreaterThan(1);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === "/api/voice/elevenlabs/catalog").length).toBeGreaterThan(1);
  });

  test("keeps Vault status, replacement help, and replacement error IDs unique and correctly described", async () => {
    installFetch({
      "/api/voice/credential-status": async () => jsonResponse({ ok: false, error: "unsafe status detail" }, 500),
      "/api/vault": async () => jsonResponse({ ok: false, error: "unsafe save detail" }, 500),
    });
    const renderer = await renderSettings();
    const elevenGroup = renderer.root.find(
      (node) => node.type === "section" && node.props["aria-label"] === "ElevenLabs",
    );
    await act(async () => elevenGroup.findAllByType("button").find((node) => node.children.join("") === "Replace key")!.props.onClick());
    const input = byLabel(renderer, "input", "ElevenLabs API key");
    await act(async () => input.props.onChange({ target: { value: "xi-secret" } }));
    await act(async () => button(renderer, "Save key").props.onClick());

    const idNodes = renderer.root.findAll((node) => typeof node.type === "string" && typeof node.props.id === "string");
    const ids = idNodes.map((node) => node.props.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    const statusError = idNodes.find((node) => node.children.join("").includes("Couldn't load voice credential status"))!;
    const retry = elevenGroup.find((node) => node.type === "button" && node.props["aria-label"] === "Retry ElevenLabs credential status");
    expect(retry.props["aria-describedby"]).toBe(statusError.props.id);
    expect(elevenGroup.find((node) => node.type === "button" && node.children.join("") === "Replace key").props["aria-describedby"])
      .toBe(statusError.props.id);
    const describedIds = byLabel(renderer, "input", "ElevenLabs API key").props["aria-describedby"].split(" ");
    expect(describedIds).toHaveLength(2);
    expect(describedIds).not.toContain(statusError.props.id);
    for (const id of describedIds) {
      expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === id)).toHaveLength(1);
    }
    expect(renderer.root.find((node) => typeof node.type === "string" && node.props.id === describedIds[0]).children.join(""))
      .toContain("never displayed");
    expect(renderer.root.find((node) => typeof node.type === "string" && node.props.id === describedIds[1]).props.role).toBe("alert");
  });

  test("environment-owned credentials show source guidance and cannot open the encrypted editor", async () => {
    installFetch({
      "/api/voice/credential-status": async () => jsonResponse({
        ok: true,
        credentials: [
          { key: "ELEVENLABS_API_KEY", status: "env-only", hasValue: true, storage: null, source: "env-local" },
          { key: "OPENAI_API_KEY", status: "env-only", hasValue: true, storage: null, source: "process-env" },
        ],
      }),
    });
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("Update ELEVENLABS_API_KEY in .env.local, then restart Cave.");
    expect(text(renderer)).toContain("Update OPENAI_API_KEY in the process environment, then restart Cave.");
    expect(renderer.root.findAll((node) => node.type === "button" && node.children.join("") === "Replace key")).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.type === "input" && /API key/.test(node.props["aria-label"] ?? ""))).toHaveLength(0);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  test("credential editors stay unavailable while ownership is loading", async () => {
    const pending = deferred<Response>();
    installFetch({
      "/api/voice/credential-status": async () => pending.promise,
    });
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("Checking…");
    expect(renderer.root.findAll((node) => node.type === "button" && node.children.join("") === "Replace key")).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.type === "input" && /API key/.test(node.props["aria-label"] ?? ""))).toHaveLength(0);

    await act(async () => {
      pending.resolve(jsonResponse(credentialPayload));
      await pending.promise;
      await Promise.resolve();
    });
    expect(renderer.root.findAll((node) => node.type === "button" && node.children.join("") === "Replace key")).toHaveLength(2);
  });

  test("missing and encrypted Vault-owned credentials remain editable with blank inputs", async () => {
    const renderer = await renderSettings();
    for (const [groupLabel, inputLabel] of [
      ["ElevenLabs", "ElevenLabs API key"],
      ["OpenAI Realtime", "OpenAI API key"],
    ]) {
      const group = renderer.root.find(
        (node) => node.type === "section" && node.props["aria-label"] === groupLabel,
      );
      await act(async () => group.findAllByType("button").find((node) => node.children.join("") === "Replace key")!.props.onClick());
      const input = byLabel(renderer, "input", inputLabel);
      expect(input.props.type).toBe("password");
      expect(input.props.value).toBe("");
      await act(async () => button(renderer, "Cancel").props.onClick());
    }
  });

  test("aborts credential writes on Cancel and outer close without late effects, then reopens fresh", async () => {
    const renderer = await renderSettings();
    const elevenGroup = renderer.root.find(
      (node) => node.type === "section" && node.props["aria-label"] === "ElevenLabs",
    );
    const replaceKey = () => elevenGroup.findAllByType("button").find((node) => node.children.join("") === "Replace key")!;
    announce.mockClear();
    const writes: Array<{ signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }> = [];
    let vaultReads = 0;
    let catalogReads = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/vault" && init?.method === "POST") {
        const response = deferred<Response>();
        writes.push({ signal: init.signal as AbortSignal, response });
        return response.promise;
      }
      if (url === "/api/voice/credential-status") {
        vaultReads += 1;
        return jsonResponse(credentialPayload);
      }
      if (url === "/api/voice/elevenlabs/catalog") {
        catalogReads += 1;
        return jsonResponse(elevenPayload);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => replaceKey().props.onClick());
    await act(async () => byLabel(renderer, "input", "ElevenLabs API key").props.onChange({ target: { value: "first-secret" } }));
    await act(async () => {
      button(renderer, "Save key").props.onClick();
      await Promise.resolve();
    });
    expect(writes).toHaveLength(1);
    await act(async () => button(renderer, "Cancel").props.onClick());
    expect(writes[0].signal.aborted).toBe(true);
    expect(renderer.root.findAll((node) => node.type === "input" && node.props["aria-label"] === "ElevenLabs API key")).toHaveLength(0);
    await act(async () => {
      writes[0].response.resolve(jsonResponse({ ok: true }));
      await writes[0].response.promise;
      await Promise.resolve();
    });
    expect(announce).not.toHaveBeenCalled();
    expect(vaultReads).toBe(0);
    expect(catalogReads).toBe(0);

    await act(async () => replaceKey().props.onClick());
    expect(byLabel(renderer, "input", "ElevenLabs API key").props.value).toBe("");
    expect(text(renderer)).not.toContain("first-secret");
    await act(async () => byLabel(renderer, "input", "ElevenLabs API key").props.onChange({ target: { value: "second-secret" } }));
    await act(async () => {
      button(renderer, "Save key").props.onClick();
      await Promise.resolve();
    });
    expect(writes).toHaveLength(2);
    await act(async () => replaceKey().props.onClick());
    expect(writes[1].signal.aborted).toBe(true);
    expect(text(renderer)).not.toContain("second-secret");
    await act(async () => {
      writes[1].response.resolve(jsonResponse({ ok: true }));
      await writes[1].response.promise;
      await Promise.resolve();
    });
    expect(announce).not.toHaveBeenCalled();
    expect(vaultReads).toBe(0);
    expect(catalogReads).toBe(0);
    await act(async () => replaceKey().props.onClick());
    expect(byLabel(renderer, "input", "ElevenLabs API key").props.value).toBe("");
    expect(renderer.root.findAll((node) => node.props.role === "alert" && node.children.join("").includes("save"))).toHaveLength(0);
  });

  test("Vault Retry reloads credential state", async () => {
    let reads = 0;
    installFetch({
      "/api/voice/credential-status": async () => {
        reads += 1;
        return reads === 1
          ? jsonResponse({ ok: false }, 500)
          : jsonResponse(credentialPayload);
      },
    });
    const renderer = await renderSettings();
    const elevenGroup = renderer.root.find(
      (node) => node.type === "section" && node.props["aria-label"] === "ElevenLabs",
    );
    const retry = elevenGroup.findAllByType("button").find((node) => node.children.join("") === "Retry")!;
    await act(async () => retry.props.onClick());
    expect(reads).toBe(2);
    expect(text(renderer)).toContain("Configured · Cave encrypted storage");
    expect(announce).toHaveBeenCalledWith("Voice credential status refreshed.", "polite");
  });

  test("simultaneous recovery actions have unique provider-and-purpose labels", async () => {
    preferences.voice = {
      defaultProvider: "elevenlabs",
      defaultModel: "eleven_turbo_v2_5",
      defaultVoice: "21m00Tcm4TlvDq8ikWAM",
    };
    installFetch({
      "/api/voice/credential-status": async () => jsonResponse({ ok: false }, 500),
      "/api/voice/elevenlabs/catalog": async () => jsonResponse({ ok: false, error: "elevenlabs_unreachable" }, 502),
    });
    const renderer = await renderSettings();
    const retries = renderer.root.findAll(
      (node) => node.type === "button" && node.children.join("") === "Retry",
    );
    const labels = retries.map((node) => node.props["aria-label"]);
    expect(labels.every((label) => typeof label === "string" && label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("shows reviewed OpenAI traits and starts, stops, replaces, and cleans up previews with static errors", async () => {
    preferences.voice = { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "sage" };
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("Feminine · American · calm, soothing");
    expect(text(renderer)).toContain("Masculine · British · gentle, melodic");

    await act(async () => button(renderer, "Preview").props.onClick());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => url === "/api/voice/preview?voice=alloy")).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(text(renderer)).toContain("Stop");
    await act(async () => button(renderer, "Stop").props.onClick());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(revokedUrls).toContain("blob:voice-1");

    installFetch({
      "/api/voice/preview?voice=alloy": async () => jsonResponse({ error: "raw provider secret" }, 502),
    });
    await act(async () => button(renderer, "Preview").props.onClick());
    expect(text(renderer)).toContain("Couldn’t preview this OpenAI voice");
    expect(text(renderer)).not.toContain("raw provider secret");
    expect(announce).toHaveBeenCalledWith("Couldn’t preview this OpenAI voice.", "assertive");
    const preview = button(renderer, "Preview");
    const previewErrorId = preview.props["aria-describedby"];
    expect(typeof previewErrorId).toBe("string");
    expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === previewErrorId)).toHaveLength(1);

    installFetch();
    await act(async () => button(renderer, "Preview").props.onClick());
    expect(createdUrls).toContain("blob:voice-2");
    await act(async () => renderer.unmount());
    expect(revokedUrls).toContain("blob:voice-2");
  });

  test("a loading OpenAI preview can be cancelled without starting a replacement request", async () => {
    const signals: AbortSignal[] = [];
    installFetch({
      "/api/voice/preview?voice=alloy": async (_url, init) => {
        const signal = init.signal as AbortSignal;
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
        });
      },
    });
    const renderer = await renderSettings();
    await act(async () => {
      button(renderer, "Preview").props.onClick();
      await Promise.resolve();
    });
    expect(text(renderer)).toContain("Loading…");
    await act(async () => {
      button(renderer, "Loading…").props.onClick();
      await Promise.resolve();
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(text(renderer)).toContain("Preview");
  });

  test("maps an unsupported OpenAI preview to local static copy", async () => {
    installFetch({
      "/api/voice/preview?voice=cedar": async () => jsonResponse({
        ok: false,
        error: "preview_unsupported",
        hint: "unsafe response-controlled prose",
      }, 422),
    });
    const renderer = await renderSettings();
    await act(async () => byLabel(renderer, "select", "OpenAI audition voice").props.onChange({ target: { value: "cedar" } }));
    await act(async () => button(renderer, "Preview").props.onClick());
    expect(text(renderer)).toContain("This realtime-only voice doesn’t have a spoken preview yet. It still works in live calls.");
    expect(text(renderer)).not.toContain("unsafe response-controlled prose");
    expect(announce).toHaveBeenCalledWith("This realtime-only voice doesn’t have a spoken preview yet. It still works in live calls.", "assertive");
  });

  test("offers only verified ready local voices, preserves unavailable saved ids, retries failures, and commits drafts on blur", async () => {
    preferences.voice = { defaultProvider: "local", defaultModel: "llama-local", defaultVoice: "missing-saved" };
    const renderer = await renderSettings();
    const voices = byLabel(renderer, "select", "Local voice");
    expect(voices.findAllByType("option").map((option) => option.props.value)).toEqual([
      "",
      "missing-saved",
      "piper-en-us-lessac-medium",
    ]);
    expect(text(renderer)).toContain("Saved local voice unavailable");
    expect(text(renderer)).not.toContain("Not ready");
    const model = byLabel(renderer, "input", "Local model");
    await act(async () => model.props.onChange({ target: { value: "draft-local" } }));
    expect(updateAppPreferences).not.toHaveBeenCalled();
    await act(async () => model.props.onBlur());
    expect(updateAppPreferences).toHaveBeenLastCalledWith({ voice: { defaultModel: "draft-local" } });
    expect(announce).toHaveBeenLastCalledWith("Local model saved.", "polite");

    await act(async () => renderer.unmount());
    installFetch({ "/api/voice/engines": async () => jsonResponse({ ok: false }, 500) });
    const failed = await renderSettings();
    expect(text(failed)).toContain("Couldn’t load local voices");
    expect(text(failed)).toContain("missing-saved");
    await act(async () => button(failed, "Retry").props.onClick());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === "/api/voice/engines").length).toBe(2);
  });

  test("refreshes the Local catalog after engine changes and stops listening outside Local", async () => {
    preferences.voice = {
      defaultProvider: "local",
      defaultModel: "llama-local",
      defaultVoice: "piper-a",
    };
    let localReads = 0;
    let catalog = {
      ...localPayload,
      ttsVoices: [
        { id: "piper-a", name: "Piper A", engine: "piper", ready: true, verified: true },
      ],
    };
    installFetch({
      "/api/voice/engines": async () => {
        localReads += 1;
        return jsonResponse(catalog);
      },
    });
    const renderer = await renderSettings();
    expect(byLabel(renderer, "select", "Local voice").findAllByType("option").map((option) => option.props.value))
      .toEqual(["", "piper-a"]);
    expect(localReads).toBe(1);

    catalog = {
      ...localPayload,
      ttsVoices: [
        { id: "piper-b", name: "Piper B", engine: "piper", ready: true, verified: true },
      ],
    };
    announce.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("cave:voice-engines-refresh"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localReads).toBe(2);
    expect(byLabel(renderer, "select", "Local voice").findAllByType("option").map((option) => option.props.value))
      .toEqual(["", "piper-a", "piper-b"]);
    expect(text(renderer)).toContain("Saved local voice unavailable");
    expect(text(renderer)).toContain("Piper B");
    expect(announce).not.toHaveBeenCalled();

    preferences.voice = {
      defaultProvider: "openai",
      defaultModel: "gpt-realtime",
      defaultVoice: "alloy",
    };
    await act(async () => renderer.update(<VoiceProviderSettings />));
    window.dispatchEvent(new Event("cave:voice-engines-refresh"));
    await act(async () => { await Promise.resolve(); });
    expect(localReads).toBe(2);

    preferences.voice = {
      defaultProvider: "local",
      defaultModel: "llama-local",
      defaultVoice: "piper-b",
    };
    await act(async () => {
      renderer.update(<VoiceProviderSettings />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localReads).toBe(3);
    await act(async () => renderer.unmount());
    window.dispatchEvent(new Event("cave:voice-engines-refresh"));
    await Promise.resolve();
    expect(localReads).toBe(3);
  });

  test("Enter blurs and commits a provider text draft exactly once without losing it", async () => {
    preferences.voice = { defaultProvider: "local", defaultModel: "llama-local", defaultVoice: "" };
    const renderer = await renderSettings();
    const model = byLabel(renderer, "input", "Local model");
    await act(async () => model.props.onChange({ target: { value: "typed-local-model" } }));
    const blur = vi.fn(() => model.props.onBlur());
    await act(async () => model.props.onKeyDown({ key: "Enter", currentTarget: { blur } }));
    expect(blur).toHaveBeenCalledTimes(1);
    expect(updateAppPreferences).toHaveBeenCalledTimes(1);
    expect(updateAppPreferences).toHaveBeenCalledWith({ voice: { defaultModel: "typed-local-model" } });
    expect(byLabel(renderer, "input", "Local model").props.value).toBe("typed-local-model");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Local model saved.", "polite");
  });

  test("an external preference refresh cannot clobber a focused text draft before blur", async () => {
    preferences.voice = { defaultProvider: "local", defaultModel: "initial-model", defaultVoice: "" };
    const renderer = await renderSettings();
    const model = byLabel(renderer, "input", "Local model");
    await act(async () => {
      model.props.onFocus();
      model.props.onChange({ target: { value: "owned-draft" } });
    });
    preferences.voice = { defaultProvider: "local", defaultModel: "external-refresh", defaultVoice: "" };
    await act(async () => {
      renderer.update(<VoiceProviderSettings />);
      await Promise.resolve();
    });
    expect(byLabel(renderer, "input", "Local model").props.value).toBe("owned-draft");
    expect(updateAppPreferences).not.toHaveBeenCalled();
    await act(async () => byLabel(renderer, "input", "Local model").props.onBlur());
    expect(updateAppPreferences).toHaveBeenCalledTimes(1);
    expect(updateAppPreferences).toHaveBeenCalledWith({ voice: { defaultModel: "owned-draft" } });
  });

  test("explains the keyless familiar path and aborts every stale request while revoking preview URLs", async () => {
    preferences.voice = { defaultProvider: "familiar", defaultModel: "", defaultVoice: "Ava" };
    const pendingSignals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal) pendingSignals.push(init.signal);
      return new Promise(() => {});
    });
    const renderer = await renderSettings();
    expect(text(renderer)).toContain("familiar runtime, identity, memory, and skills");
    expect(byLabel(renderer, "input", "System voice (optional)").props.value).toBe("Ava");
    await act(async () => renderer.unmount());
    expect(pendingSignals.length).toBeGreaterThanOrEqual(2);
    expect(pendingSignals.every((signal) => signal.aborted)).toBe(true);
  });
});
