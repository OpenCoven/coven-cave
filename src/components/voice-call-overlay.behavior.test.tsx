// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mic: vi.fn(), connect: vi.fn(), announce: vi.fn() }));
vi.mock("react-dom", () => ({ createPortal: (node) => node }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: mocks.announce }) }));
vi.mock("./arcade-panel", () => ({ ArcadePanel: () => null }));
vi.mock("@/lib/voice/registry", () => ({ getVoiceProvider: () => ({ clientAdapter: { connect: mocks.connect } }) }));
vi.mock("@/lib/voice/microphone-access", () => ({
  requestMicrophoneStream: mocks.mic,
  classifyMicrophoneCaptureError: () => ({ code: "microphone_denied" }),
  openMicrophoneSettings: vi.fn(),
}));
import { VoiceCallOverlay } from "./voice-call-overlay";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const familiar = { id: "voice-test", display_name: "Test familiar", voiceProvider: "openai" };
let renderer;
let track;
let sessions;
let callbacks;
let onClose;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function mount() {
  await act(async () => {
    renderer = create(<VoiceCallOverlay familiar={familiar} sessionId="voice-test-session" onClose={onClose} />);
  });
}
beforeEach(() => {
  vi.stubGlobal("document", { body: {} });
  track = { stop: vi.fn(), enabled: true };
  sessions = []; callbacks = []; onClose = vi.fn();
  mocks.mic.mockReset().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
  mocks.connect.mockReset().mockImplementation(async (_grant, _mic, cb) => {
    callbacks.push(cb);
    const live = { close: vi.fn(async () => {}), setMuted: vi.fn(), sendText: vi.fn(), inboundAudio: {} };
    sessions.push(live); return live;
  });
  vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/voice/session"
    ? Response.json({ ok: true, callId: "test-call", grant: { provider: "openai" } })
    : Response.json({ ok: true })));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null; vi.unstubAllGlobals();
});

test("unmount releases the live call and microphone", async () => {
  await mount();
  expect(sessions).toHaveLength(1);
  await act(async () => renderer.unmount()); renderer = null;
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(track.stop).toHaveBeenCalled();
});

test("unmount aborts a pending mint and releases the acquired microphone", async () => {
  const pending = deferred();
  let signal;
  vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return pending.promise; }));
  await mount();
  await act(async () => renderer.unmount()); renderer = null;
  expect(track.stop).toHaveBeenCalled();
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(Response.json({ ok: true, callId: "late", grant: { provider: "openai" } })));
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("callbacks from a failed attempt cannot close or persist into its retry", async () => {
  await mount();
  const stale = callbacks[0];
  await act(async () => stale.onError(new Error("provider_error")));
  const retry = renderer.root.findAllByType("button").find(button => button.props.children === "Try again");
  await act(async () => retry.props.onClick());
  expect(sessions).toHaveLength(2);
  const before = fetch.mock.calls.length;
  await act(async () => {
    stale.onUserTranscriptFinal("This belongs to the old call");
    stale.onDisconnect();
  });
  expect(fetch.mock.calls).toHaveLength(before);
  expect(onClose).not.toHaveBeenCalled();
  expect(sessions[1].close).not.toHaveBeenCalled();
});

test("mute exposes its state and announces the change", async () => {
  await mount();
  const mute = renderer.root.findByProps({ "aria-label": "Mute" });
  await act(async () => mute.props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Unmute" }).props["aria-pressed"]).toBe(true);
  expect(sessions[0].setMuted).toHaveBeenLastCalledWith(true);
  expect(mocks.announce).toHaveBeenCalledWith("Microphone muted.", "polite");
  expect(renderer.root.findByProps({ className: "voice-call-overlay__state" }).props.children).toBe("Microphone off");
});

test("a microphone granted after unmount is immediately released", async () => {
  const pending = deferred();
  mocks.mic.mockReturnValue(pending.promise);
  await mount();
  await act(async () => renderer.unmount()); renderer = null;
  await act(async () => pending.resolve({ getTracks: () => [track], getAudioTracks: () => [track] }));
  expect(track.stop).toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("a provider connection completed after unmount is closed", async () => {
  const pending = deferred();
  mocks.connect.mockReturnValue(pending.promise);
  await mount();
  const signal = mocks.connect.mock.calls[0][3];
  await act(async () => renderer.unmount()); renderer = null;
  expect(signal.aborted).toBe(true);
  const live = { close: vi.fn(async () => {}) };
  await act(async () => pending.resolve(live));
  expect(live.close).toHaveBeenCalledTimes(1);
  expect(track.stop).toHaveBeenCalled();
});
