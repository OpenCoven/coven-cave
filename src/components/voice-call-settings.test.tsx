// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: mocks.announce }) }));
vi.mock("@/components/ui/modal", () => ({ Modal: ({ children, footerActions }) => <div>{children}{footerActions}</div> }));
vi.mock("@/components/ui/button", () => ({ Button: props => <button {...props} /> }));
vi.mock("@/components/ui/select", () => ({ StandardSelect: props => <select {...props} /> }));
import { VoiceCallSettings } from "./voice-call-settings";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let saved;
let closed;
let configRequests;
const familiar = { id: "f1", display_name: "Salem", voiceProvider: "openai", voiceModel: "gpt-realtime", voiceName: "verse" };
beforeEach(() => {
  saved = vi.fn(); closed = vi.fn(); configRequests = [];
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (url === "/api/config") { configRequests.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    return Response.json({ ok: true, voices: [{ id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" }, { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" }], models: [{ id: "eleven_v3_conversational", name: "v3 Conversational" }, { id: "eleven_flash_v2_5", name: "Flash" }] });
  }));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; vi.unstubAllGlobals(); });
async function mount(value = familiar) { await act(async () => { renderer = create(<VoiceCallSettings familiar={value} onSaved={saved} onClose={closed} />); }); }
const select = label => renderer.root.findByType("div").findAllByType("select").find(n => n.props.label === label);
const button = text => renderer.root.findAllByType("button").find(n => n.props.children === text);

test("provider switch saves compatible defaults atomically and refreshes the familiar", async () => {
  await mount();
  await act(async () => select("Voice provider").props.onChange("elevenlabs"));
  expect(select("Voice delivery").props.value).toBe("eleven_v3_conversational");
  await act(async () => select("Familiar voice").props.onChange("EXAVITQu4vr4xnSDxMaL"));
  await act(async () => button("Save and reconnect").props.onClick());
  expect(configRequests).toEqual([{ familiars: { f1: { voiceProvider: "elevenlabs", voiceModel: "eleven_v3_conversational", voiceName: "EXAVITQu4vr4xnSDxMaL" } } }]);
  expect(saved).toHaveBeenCalledWith({ voiceProvider: "elevenlabs", voiceModel: "eleven_v3_conversational", voiceName: "EXAVITQu4vr4xnSDxMaL" });
  expect(window.dispatchEvent).toHaveBeenCalled();
});

test("opening settings preserves an explicitly saved model and voice", async () => {
  await mount();
  await act(async () => button("Save and reconnect").props.onClick());
  expect(saved).toHaveBeenCalledWith({ voiceProvider: "openai", voiceModel: "gpt-realtime", voiceName: "verse" });
});

test("failed save keeps the call and selection intact for retry", async () => {
  await mount();
  fetch.mockResolvedValueOnce(Response.json({ ok: false }, { status: 500 }));
  await act(async () => button("Save and reconnect").props.onClick());
  expect(saved).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: "alert" }).props.children).toMatch(/Couldn't confirm/);
  expect(select("Familiar voice").props.value).toBe("verse");
  await act(async () => button("Save and reconnect").props.onClick());
  expect(saved).toHaveBeenCalledTimes(1);
});

test("catalog errors offer recovery and cannot be saved as an empty catalog", async () => {
  fetch.mockResolvedValueOnce(Response.json({ ok: false, error: "vault_key_unresolved", missingKey: "ELEVENLABS_API_KEY" }, { status: 503 }));
  await mount({ ...familiar, voiceProvider: "elevenlabs", voiceModel: undefined, voiceName: undefined });
  expect(button("Save and reconnect").props.disabled).toBe(true);
  expect(button("Retry voices")).toBeDefined();
  await act(async () => button("Retry voices").props.onClick());
  expect(select("Familiar voice").props.options.length).toBe(2);
});

test("unmount cancels an outstanding save and cannot reconnect later", async () => {
  await mount();
  let finish; let signal;
  fetch.mockImplementationOnce((_url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); });
  await act(async () => button("Save and reconnect").props.onClick());
  await act(async () => renderer.unmount()); renderer = null;
  expect(signal.aborted).toBe(true);
  await act(async () => finish(Response.json({ ok: true })));
  expect(saved).not.toHaveBeenCalled();
});
