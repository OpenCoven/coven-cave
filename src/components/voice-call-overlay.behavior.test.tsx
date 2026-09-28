// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mic: vi.fn(), connect: vi.fn(), announce: vi.fn() }));
vi.mock("react-dom", () => ({ createPortal: (node) => node }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: mocks.announce }) }));
vi.mock("./arcade-panel", () => ({ ArcadePanel: () => null }));
vi.mock("./voice-call-settings", () => ({ VoiceCallSettings: () => null }));
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

test("interleaved captions reconcile by item and interruption does not persist a partial", async () => {
  await mount();
  await act(async () => {
    callbacks[0].onPartialTranscript("assistant", "Hello", "a1");
    callbacks[0].onUserTranscriptFinal("Wait", "u1");
    callbacks[0].onAssistantTranscriptFinal("Hello Val.", "a1");
    callbacks[0].onPartialTranscript("assistant", "Unfinished", "a2");
  });
  const before = fetch.mock.calls.length;
  await act(async () => callbacks[0].onTranscriptInterrupted("assistant", "a2"));
  const turns = renderer.root.findAllByType("li");
  expect(turns).toHaveLength(3);
  expect(turns.every(turn => !turn.props["aria-busy"])).toBe(true);
  expect(fetch.mock.calls).toHaveLength(before);
});

test("playing keeps recent captions above the game and full history reachable", async () => {
  await mount();
  await act(async () => {
    callbacks[0].onUserTranscriptFinal("First", "u1");
    callbacks[0].onAssistantTranscriptFinal("Second", "a1");
    callbacks[0].onUserTranscriptFinal("Latest", "u2");
    renderer.root.findByProps({ "aria-label": "Play Glitter Crypt" }).props.onClick();
  });
  const captions = renderer.root.findByProps({ "aria-label": "Live game captions" });
  expect(captions.findAllByType("li")).toHaveLength(2);
  expect(captions.findAllByType("li").at(-1).findByType("p").props.children).toBe("Latest");
  await act(async () => renderer.root.findByProps({ "aria-label": "Show full transcript" }).props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Call transcript" }).findAllByType("li")).toHaveLength(3);
});

test("changing voice reconnects, preserves captions and mute, and ignores old callbacks", async () => {
  await mount();
  await act(async () => {
    callbacks[0].onUserTranscriptFinal("Keep this conversation", "u1");
    renderer.root.findByProps({ "aria-label": "Mute" }).props.onClick();
    renderer.root.findByProps({ "aria-label": "Change familiar voice" }).props.onClick();
  });
  const settings = renderer.root.find(node => typeof node.type === "function" && node.type.name === "VoiceCallSettings");
  await act(async () => settings.props.onSaved({ voiceProvider: "elevenlabs", voiceModel: "eleven_v3_conversational", voiceName: "Rachel" }));
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(sessions).toHaveLength(2);
  expect(sessions[1].setMuted).toHaveBeenLastCalledWith(true);
  expect(renderer.root.findByProps({ "aria-label": "Call transcript" }).findAllByType("li")).toHaveLength(1);
  const before = fetch.mock.calls.length;
  await act(async () => callbacks[0].onUserTranscriptFinal("Stale", "old"));
  expect(fetch.mock.calls).toHaveLength(before);
});

test("retrying a failed voice change keeps the conversation and muted microphone", async () => {
  await mount();
  await act(async () => {
    callbacks[0].onUserTranscriptFinal("Keep me", "u1");
    renderer.root.findByProps({ "aria-label": "Mute" }).props.onClick();
    renderer.root.findByProps({ "aria-label": "Change familiar voice" }).props.onClick();
  });
  mocks.connect.mockRejectedValueOnce(new Error("network"));
  const settings = renderer.root.find(node => typeof node.type === "function" && node.type.name === "VoiceCallSettings");
  await act(async () => settings.props.onSaved({ voiceProvider: "elevenlabs" }));
  await act(async () => renderer.root.findAllByType("button").find(b => b.props.children === "Try again").props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Call transcript" }).findAllByType("li")).toHaveLength(1);
  expect(renderer.root.findByProps({ "aria-label": "Unmute" }).props["aria-pressed"]).toBe(true);
  expect(sessions.at(-1).setMuted).toHaveBeenLastCalledWith(true);
});

test("a quoted reply draft survives a failed voice switch and reconnect", async () => {
  await mount();
  await act(async () => callbacks[0].onAssistantTranscriptFinal("Remember this answer", "a1"));
  const reply = renderer.root.findAllByType("button").find(b => b.props.children === "Reply");
  await act(async () => reply.props.onClick());
  await act(async () => renderer.root.findByProps({ "aria-label": "Reply without speaking" }).props.onChange({ target: { value: "My unfinished reply" } }));
  await act(async () => renderer.root.findByProps({ "aria-label": "Change familiar voice" }).props.onClick());
  mocks.connect.mockRejectedValueOnce(new Error("network"));
  const settings = renderer.root.find(node => typeof node.type === "function" && node.type.name === "VoiceCallSettings");
  await act(async () => settings.props.onSaved({ voiceProvider: "elevenlabs" }));
  await act(async () => renderer.root.findAllByType("button").find(b => b.props.children === "Try again").props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Reply without speaking" }).props.value).toBe("My unfinished reply");
  expect(renderer.root.findByProps({ className: "voice-call-overlay__reply-snippet" }).props.children).toBe("Remember this answer");
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(sessions.at(-1).sendText).toHaveBeenCalledWith(expect.stringContaining("Remember this answer"));
  expect(sessions.at(-1).sendText).toHaveBeenCalledWith(expect.stringContaining("My unfinished reply"));
});

test("long calls can reveal earlier turns without losing the latest captions", async () => {
  await mount();
  await act(async () => {
    for (let i = 0; i < 72; i++) callbacks[0].onUserTranscriptFinal(`Turn ${i}`, `u${i}`);
  });
  expect(renderer.root.findByProps({ "aria-label": "Call transcript" }).findAllByType("li")).toHaveLength(61);
  await act(async () => renderer.root.findAllByType("button").find(b => b.props.children === "Show earlier turns").props.onClick());
  const turns = renderer.root.findByProps({ "aria-label": "Call transcript" }).findAllByType("li");
  expect(turns).toHaveLength(72);
  expect(turns[0].findByType("p").props.children.join("")).toBe("Turn 0");
});

test("switching chats behind a call cannot reconnect its familiar into another chat", async () => {
  await mount();
  await act(async () => renderer.update(<VoiceCallOverlay familiar={{ id: "other", display_name: "Other familiar", voiceProvider: "openai" }} sessionId="other-session" onClose={onClose} />));
  await act(async () => renderer.root.findByProps({ "aria-label": "Change familiar voice" }).props.onClick());
  const settings = renderer.root.find(node => typeof node.type === "function" && node.type.name === "VoiceCallSettings");
  expect(settings.props.familiar.id).toBe("voice-test");
  await act(async () => settings.props.onSaved({ voiceProvider: "elevenlabs" }));
  const mints = fetch.mock.calls.filter(([url]) => url === "/api/voice/session");
  expect(JSON.parse(mints.at(-1)[1].body)).toEqual({ familiarId: "voice-test", sessionId: "voice-test-session" });
});
