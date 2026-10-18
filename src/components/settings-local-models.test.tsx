// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
//
// Settings → Local models (#6049): each server says whether it answers and
// what to do next, an address set by the environment or viewed from another
// device can't be edited, and a save re-reads the server and tells model
// menus to refresh.
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveRegionProvider } from "@/components/ui/live-region";
import { LocalModelsSection, serverStatusLine } from "./settings-local-models";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: { children?: unknown[] }): string {
  return (node.children ?? [])
    .map((child) => typeof child === "string" ? child : child && typeof child === "object" ? textContent(child) : "")
    .join("");
}

const backend = (overrides) => ({
  backend: "ollama",
  harness: "codex-ollama",
  product: "Ollama",
  label: "Codex · Ollama",
  defaultEndpoint: "http://127.0.0.1:11434",
  endpointEnv: "CAVE_OLLAMA_URL",
  startHint: "Start Ollama (open the app, or run `ollama serve`).",
  addModelHint: "Pull a model with tool support, for example `ollama pull qwen3:8b`.",
  endpoint: "http://127.0.0.1:11434",
  source: "default",
  savedEndpoint: null,
  server: { state: "stopped" },
  ...overrides,
});

const lmstudio = (overrides = {}) => backend({
  backend: "lmstudio",
  harness: "codex-lmstudio",
  product: "LM Studio",
  label: "Codex · LM Studio",
  defaultEndpoint: "http://127.0.0.1:1234",
  endpointEnv: "CAVE_LMSTUDIO_URL",
  startHint: "Start LM Studio's server (Developer tab, or run `lms server start`).",
  addModelHint: "Download a model with tool support in LM Studio, for example Qwen3 8B.",
  endpoint: "http://127.0.0.1:1234",
  ...overrides,
});

const statusOf = (backends, extra = {}) => ({
  ok: true,
  editable: true,
  allowRemote: { value: false, source: "default" },
  backends,
  ...extra,
});

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

async function render(fetchMock) {
  vi.stubGlobal("fetch", fetchMock);
  let renderer;
  await act(async () => {
    renderer = create(<LiveRegionProvider><LocalModelsSection /></LiveRegionProvider>);
  });
  return renderer;
}

const statusLines = (renderer) => renderer.root.findAll((node) => node.props?.className === "settings-local-models__status").map(textContent);
const inputs = (renderer) => renderer.root.findAllByType("input").filter((node) => node.props.inputMode === "url");
const buttonNamed = (renderer, name) => renderer.root.findAllByType("button").find((node) => textContent(node) === name);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalModelsSection", () => {
  it("says what each server is doing and marks the models Codex can use", async () => {
    const renderer = await render(vi.fn(async () => reply(statusOf([
      backend({
        server: {
          state: "running", version: "0.21.0",
          models: [{ name: "llama2:7b", tools: false, contextLength: 4096 }, { name: "qwen3:8b", tools: true, contextLength: 40960 }],
        },
      }),
      lmstudio(),
    ]))));
    expect(statusLines(renderer)).toEqual([
      "Running · version 0.21.0 · 1 model with tool support",
      "Not running at http://127.0.0.1:1234. Start LM Studio's server (Developer tab, or run `lms server start`).",
    ]);
    const models = renderer.root.findAll((node) => node.props?.className === "settings-local-models__model").map(textContent);
    expect(models).toEqual([
      "llama2:7b4,096-token contextNo tool support · Codex can't use it",
      "qwen3:8b40,960-token contextTool support",
    ]);
    expect(renderer.root.findAll((node) => node.props?.role === "group").map((node) => node.props["aria-label"])).toEqual(["Ollama", "LM Studio", "Network"]);
  });

  it("locks an address the environment sets, and every address on another device", async () => {
    const renderer = await render(vi.fn(async () => reply(statusOf([
      backend({ source: "environment", endpoint: "http://127.0.0.1:11600" }),
      lmstudio(),
    ]))));
    const [ollamaInput, lmstudioInput] = inputs(renderer);
    expect(ollamaInput.props.disabled).toBe(true);
    expect(ollamaInput.props.value).toBe("http://127.0.0.1:11600");
    expect(textContent(renderer.root)).toContain("Set by CAVE_OLLAMA_URL in Cave's environment.");
    expect(lmstudioInput.props.disabled).toBe(false);

    const remote = await render(vi.fn(async () => reply(statusOf([backend({}), lmstudio()], { editable: false }))));
    expect(inputs(remote).every((input) => input.props.disabled)).toBe(true);
    expect(textContent(remote.root)).toContain("Change this on the computer running Cave.");
    expect(buttonNamed(remote, "Save address")).toBeUndefined();
    expect(remote.root.findByProps({ role: "switch" }).props.disabled).toBe(true);
  });

  it("saves an address, shows the server at it, and tells model menus to refresh", async () => {
    const fetchMock = vi.fn(async (_url, init) => init?.method === "PUT"
      ? reply(statusOf([
        backend({ source: "settings", endpoint: "http://127.0.0.1:11500", savedEndpoint: "http://127.0.0.1:11500", server: { state: "running", version: "0.21.0", models: [] } }),
        lmstudio(),
      ]))
      : reply(statusOf([backend({}), lmstudio()])));
    // The suite runs without a DOM; the refresh event only needs an event target.
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const refreshed = vi.fn();
    target.addEventListener("cave:familiars-refresh", refreshed);
    try {
      const renderer = await render(fetchMock);
      expect(buttonNamed(renderer, "Save address").props.disabled).toBe(true);
      await act(async () => inputs(renderer)[0].props.onChange({ target: { value: " http://127.0.0.1:11500 " } }));
      expect(buttonNamed(renderer, "Save address").props.disabled).toBe(false);
      const form = renderer.root.findAllByType("form")[0];
      await act(async () => form.props.onSubmit({ preventDefault: () => {} }));
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(put[0]).toBe("/api/local-models");
      expect(JSON.parse(put[1].body)).toEqual({ endpoints: { ollama: "http://127.0.0.1:11500" } });
      expect(statusLines(renderer)[0]).toBe("Running · version 0.21.0, but no model has tool support. Pull a model with tool support, for example `ollama pull qwen3:8b`.");
      expect(inputs(renderer)[0].props.value).toBe("http://127.0.0.1:11500");
      expect(refreshed).toHaveBeenCalledTimes(1);
    } finally {
      target.removeEventListener("cave:familiars-refresh", refreshed);
    }
  });

  it("keeps a refused address in the field with the reason beside it", async () => {
    const refusal = "The Ollama address points at gpu-box.lan:11434, which isn't this computer.";
    const fetchMock = vi.fn(async (_url, init) => init?.method === "PUT"
      ? reply({ ok: false, error: refusal, field: "ollama" }, 400)
      : reply(statusOf([backend({}), lmstudio()])));
    const renderer = await render(fetchMock);
    await act(async () => inputs(renderer)[0].props.onChange({ target: { value: "http://gpu-box.lan:11434" } }));
    await act(async () => renderer.root.findAllByType("form")[0].props.onSubmit({ preventDefault: () => {} }));
    expect(inputs(renderer)[0].props.value).toBe("http://gpu-box.lan:11434");
    expect(inputs(renderer)[0].props["aria-invalid"]).toBe(true);
    expect(textContent(renderer.root)).toContain(refusal);
  });

  it("offers a retry when the status can't be read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ ok: false, error: "boom" }, 500))
      .mockResolvedValueOnce(reply(statusOf([backend({}), lmstudio()])));
    const renderer = await render(fetchMock);
    expect(textContent(renderer.root)).toContain("Couldn't load local model servers");
    await act(async () => buttonNamed(renderer, "Retry").props.onClick());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/local-models?fresh=1");
    expect(statusLines(renderer)).toHaveLength(2);
  });
});

describe("serverStatusLine", () => {
  it("names the next step for every server state", () => {
    expect(serverStatusLine(backend({ server: { state: "unexpected" } }))).toEqual({
      tone: "danger", text: "Something answered at http://127.0.0.1:11434, but not like Ollama. Check the address.",
    });
    expect(serverStatusLine(backend({ endpoint: null, server: { state: "invalid-address", reason: "The saved Ollama address isn't a URL." } }))).toEqual({
      tone: "danger", text: "The saved Ollama address isn't a URL.",
    });
    expect(serverStatusLine(lmstudio({ server: { state: "running", version: null, models: [{ name: "qwen3-8b", tools: true, contextLength: null }, { name: "b", tools: true, contextLength: null }] } })).text)
      .toBe("Running · 2 models with tool support");
  });
});
