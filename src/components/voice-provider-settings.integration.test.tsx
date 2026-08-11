// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const preferenceStore = vi.hoisted(() => ({
  snapshot: {
    voice: { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "sage" },
  },
  listeners: new Set<() => void>(),
  update: vi.fn(),
}));
const announce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app-preferences", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    preferenceStore.listeners.add(listener);
    return () => preferenceStore.listeners.delete(listener);
  };
  const getSnapshot = () => preferenceStore.snapshot;
  return {
    useAppPreferences: () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    updateAppPreferences: preferenceStore.update,
  };
});

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

// The real StandardSelect, SettingsGroup, and Button stay mounted. Only the
// icon renderer is replaced because this node renderer has no browser SVG
// layout; menus deliberately stay closed because Popover portals require a DOM.
vi.mock("@/lib/icon", () => ({
  Icon: () => <span aria-hidden="true" />,
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

function setVoice(voice: typeof preferenceStore.snapshot.voice) {
  preferenceStore.snapshot = { voice };
  for (const listener of preferenceStore.listeners) listener();
}

function trigger(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  preferenceStore.snapshot = {
    voice: { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "sage" },
  };
  preferenceStore.listeners.clear();
  preferenceStore.update.mockReset();
  announce.mockReset();
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === "/api/voice/credential-status") {
      return jsonResponse({
        ok: true,
        credentials: [
          { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
          { key: "OPENAI_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
        ],
      });
    }
    if (url === "/api/voice/elevenlabs/catalog") {
      return jsonResponse({ ok: true, voices: [], models: [] });
    }
    if (url === "/api/voice/engines") {
      return jsonResponse({
        ok: true,
        ttsVoices: [
          { id: "piper-ready", name: "Piper ready", engine: "piper", ready: true, verified: true },
        ],
        runtimes: { piper: { available: true }, kokoro: { available: false } },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("real closed Settings primitives expose valid help targets and follow reactive preference updates", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<VoiceProviderSettings />);
    await Promise.resolve();
    await Promise.resolve();
  });

  const labels = [
    "Default voice provider",
    "OpenAI Realtime voice",
    "OpenAI audition voice",
  ];
  for (const label of labels) {
    const selectTrigger = trigger(renderer, label);
    expect(selectTrigger.props["aria-haspopup"]).toBe("menu");
    expect(selectTrigger.props["aria-expanded"]).toBe(false);
    expect(selectTrigger.props.className).toContain("focus-ring");
    const descriptionId = selectTrigger.props["aria-describedby"];
    expect(typeof descriptionId).toBe("string");
    expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === descriptionId)).toHaveLength(1);
  }
  const allIds = renderer.root.findAll((node) => typeof node.type === "string" && typeof node.props.id === "string").map((node) => node.props.id);
  expect(new Set(allIds).size).toBe(allIds.length);
  expect(textContent(trigger(renderer, "OpenAI Realtime voice").children)).toContain("Sage");

  await act(async () => {
    setVoice({ defaultProvider: "local", defaultModel: "local-model", defaultVoice: "piper-ready" });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(textContent(trigger(renderer, "Default voice provider").children)).toContain("Local (on-device)");
  const localTrigger = trigger(renderer, "Local voice");
  const localHelpId = localTrigger.props["aria-describedby"];
  expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === localHelpId)).toHaveLength(1);
  expect(textContent(renderer.root.find((node) => typeof node.type === "string" && node.props.id === localHelpId).children)).toContain("verified voices");

  await act(async () => renderer.unmount());
});

test("real Button primitives reference each visible credential and preview diagnostic", async () => {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === "/api/voice/credential-status") return jsonResponse({ ok: false }, 500);
    if (url === "/api/voice/elevenlabs/catalog") return jsonResponse({ ok: true, voices: [], models: [] });
    if (url === "/api/voice/preview?voice=alloy") return jsonResponse({ error: "provider detail" }, 502);
    throw new Error(`Unexpected fetch: ${url}`);
  });

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<VoiceProviderSettings />);
    await Promise.resolve();
    await Promise.resolve();
  });

  const controls = renderer.root.findAll((node) => node.type === "button");
  const diagnosticControls = controls.filter((node) =>
    /^Retry (ElevenLabs|OpenAI) credential status$/.test(node.props["aria-label"] ?? "")
      || textContent(node.children) === "Replace key",
  );
  expect(diagnosticControls).toHaveLength(4);
  for (const control of diagnosticControls) {
    const diagnosticId = control.props["aria-describedby"];
    expect(typeof diagnosticId).toBe("string");
    expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === diagnosticId)).toHaveLength(1);
  }

  const preview = controls.find((node) => textContent(node.children) === "Preview")!;
  await act(async () => preview.props.onClick());
  const previewDiagnosticId = preview.props["aria-describedby"];
  expect(typeof previewDiagnosticId).toBe("string");
  expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.id === previewDiagnosticId)).toHaveLength(1);

  const allIds = renderer.root.findAll((node) => typeof node.type === "string" && typeof node.props.id === "string").map((node) => node.props.id);
  expect(new Set(allIds).size).toBe(allIds.length);
  await act(async () => renderer.unmount());
});

test("real Button primitives expose no credential editor while ownership is loading", async () => {
  const pending = deferred<Response>();
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === "/api/voice/credential-status") return pending.promise;
    if (url === "/api/voice/elevenlabs/catalog") return jsonResponse({ ok: true, voices: [], models: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  });

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<VoiceProviderSettings />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(renderer.root.findAll((node) => node.type === "button" && textContent(node.children) === "Replace key")).toHaveLength(0);
  expect(renderer.root.findAll((node) => node.type === "input" && /API key/.test(node.props["aria-label"] ?? ""))).toHaveLength(0);

  await act(async () => {
    pending.resolve(jsonResponse({
      ok: true,
      credentials: [
        { key: "ELEVENLABS_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
        { key: "OPENAI_API_KEY", status: "no-ref", hasValue: false, storage: null, source: null },
      ],
    }));
    await pending.promise;
    await Promise.resolve();
  });
  expect(renderer.root.findAll((node) => node.type === "button" && textContent(node.children) === "Replace key")).toHaveLength(2);
  await act(async () => renderer.unmount());
});
