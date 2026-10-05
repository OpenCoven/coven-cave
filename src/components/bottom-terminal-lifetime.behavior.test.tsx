// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BottomTerminal } from "./bottom-terminal";
import { HarnessAuthTerminal } from "./harness-auth-terminal";

const fixture = vi.hoisted(() => ({ platform: "desktop", start: null, bridges: [], stop: vi.fn(), invoke: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/tauri-platform", () => ({ useTauriPlatform: () => fixture.platform }));
vi.mock("@/lib/use-viewport", () => ({ useIsCoarsePointer: () => false }));
vi.mock("@/lib/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: fixture.announce }) }));
vi.mock("@/components/ui/modal", () => ({ Modal: ({ children }) => children }));
vi.mock("@/components/terminal-key-bar", () => ({ TerminalKeyBar: () => null }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => fixture.invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; element = {};
  loadAddon() {} attachCustomKeyEventHandler() {} open() {} write() {} focus() {} dispose() {} reset() {}
  onData() { return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class { onDidChangeResults() {} clearDecorations() {} } }));
vi.mock("@/lib/pty-ws-bridge", () => ({ PtyWsBridge: class {
  disposed = false;
  isOpen = true;
  write = vi.fn();
  reconnect = vi.fn(async () => {});
  constructor() { fixture.bridges.push(this); }
  onData() {} onReplayReset() {} onExit() {} resize() {}
  onClose(handler) { this.closeHandler = handler; }
  dispose() { this.disposed = true; }
  connect(id) { fixture.invoke("connect", id); return fixture.start; }
  kill() {
    // Closing the socket before its handshake settles cannot deliver a kill.
    if (!this.disposed) fixture.stop();
    this.dispose();
  }
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let resolveStart;
beforeEach(() => {
  fixture.bridges = [];
  fixture.stop.mockClear();
  fixture.invoke.mockReset();
  fixture.start = new Promise<void>((resolve) => { resolveStart = resolve; });
  fixture.invoke.mockImplementation((command) => {
    if (command === "pty_diagnose") return Promise.resolve({ exit: 0, bytes: 1, output: "coven-cave-pty-ok" });
    if (command === "pty_list") return Promise.resolve([]);
    if (command === "pty_start") return fixture.start;
    if (command === "pty_stop") fixture.stop();
    return Promise.resolve();
  });
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const platform of ["desktop", "browser", "ios"]) {
  for (const duringStartup of [true, false]) {
    test(`${platform}: unmount ${duringStartup ? "during" : "after"} startup reaps the temporary shell`, async () => {
      fixture.platform = platform;
      await act(async () => {
        renderer = create(<BottomTerminal threadId="cave.auth.fixture" disposeOnUnmount />, { createNodeMock: () => ({}) });
      });
      await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([cmd]) => cmd === (platform === "desktop" ? "pty_start" : "connect"))).toBe(true));
      if (!duringStartup) await act(async () => { resolveStart(); await fixture.start; });
      await act(async () => renderer.unmount());
      renderer = undefined;
      if (duringStartup) {
        expect(fixture.stop).not.toHaveBeenCalled();
        await act(async () => { resolveStart(); await fixture.start; });
      }
      expect(fixture.stop).toHaveBeenCalledTimes(1);
    });
  }
}

test("ordinary desktop terminals keep their shell on unmount", async () => {
  fixture.platform = "desktop";
  await act(async () => {
    renderer = create(<BottomTerminal threadId="cave.rail.fixture" />, { createNodeMock: () => ({}) });
  });
  await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([cmd]) => cmd === "pty_start")).toBe(true));
  await act(async () => { resolveStart(); await fixture.start; });
  await act(async () => renderer.unmount());
  renderer = undefined;
  expect(fixture.stop).not.toHaveBeenCalled();
});

const authFailure = { harness: "codex", harnessLabel: "Codex", loginCommand: "codex login" };

async function mountAuthTerminal() {
  vi.useFakeTimers();
  await act(async () => {
    renderer = create(<HarnessAuthTerminal failure={authFailure} onClose={() => {}} />, { createNodeMock: () => ({}) });
  });
  await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([cmd]) => cmd === (fixture.platform === "desktop" ? "pty_start" : "connect"))).toBe(true));
  await act(async () => { resolveStart(); await fixture.start; });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

test("sign-in sends its login command once to every replacement shell after Retry", async () => {
  fixture.platform = "desktop";
  await mountAuthTerminal();
  const startedIds = () => fixture.invoke.mock.calls.filter(([cmd]) => cmd === "pty_start").map(([, args]) => args.options.thread_id);
  const loginWrites = () => fixture.invoke.mock.calls.filter(([cmd]) => cmd === "pty_write").map(([, args]) => ({
    id: args.threadId,
    text: new TextDecoder().decode(new Uint8Array(args.bytes)),
  }));
  expect(loginWrites()).toEqual([{ id: startedIds()[0], text: "codex login\r" }]);

  // The desktop health probe finds no shell; Retry creates a new ephemeral PTY.
  for (let retry = 0; retry < 2; retry++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const button = renderer.root.findAllByType("button").find((node) => node.props.children === "Retry");
    expect(button).toBeDefined();
    await act(async () => button.props.onClick());
    await vi.waitFor(() => expect(startedIds()).toHaveLength(retry + 2));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(new Set(startedIds()).size).toBe(retry + 2);
    expect(loginWrites()).toEqual(startedIds().map((id) => ({ id, text: "codex login\r" })));
  }
});

for (const platform of ["browser", "ios"]) {
  test(`${platform}: reconnecting sign-in does not repeat the login command`, async () => {
    fixture.platform = platform;
    await mountAuthTerminal();
    const bridge = fixture.bridges[0];
    expect(bridge.write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(bridge.write.mock.calls[0][0])).toBe("codex login\r");
    let finishReconnect;
    bridge.reconnect.mockImplementation(() => new Promise<void>((resolve) => { finishReconnect = resolve; }));
    await act(async () => bridge.closeHandler(1006, "network lost"));
    // Keep recovering and healthy in separate renders, like a real handshake.
    expect(bridge.write).toHaveBeenCalledTimes(1);
    await act(async () => finishReconnect());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bridge.reconnect).toHaveBeenCalledTimes(1);
    expect(bridge.write).toHaveBeenCalledTimes(1);
    expect(fixture.bridges).toHaveLength(1);
  });
}

for (const platform of ["desktop", "browser", "ios"]) {
  test(`${platform}: closing sign-in during startup never sends a late login command`, async () => {
    fixture.platform = platform;
    await act(async () => {
      renderer = create(<HarnessAuthTerminal failure={authFailure} onClose={() => {}} />, { createNodeMock: () => ({}) });
    });
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([cmd]) => cmd === (platform === "desktop" ? "pty_start" : "connect"))).toBe(true));
    await act(async () => renderer.unmount());
    renderer = undefined;
    await act(async () => { resolveStart(); await fixture.start; });
    expect(fixture.invoke.mock.calls.filter(([cmd]) => cmd === "pty_write")).toHaveLength(0);
    for (const bridge of fixture.bridges) expect(bridge.write).not.toHaveBeenCalled();
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  });
}
