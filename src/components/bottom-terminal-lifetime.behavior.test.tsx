// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BottomTerminal, terminalThreadMounted } from "./bottom-terminal";

const fixture = vi.hoisted(() => ({ platform: "desktop", start: null, stop: vi.fn(), invoke: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/tauri-platform", () => ({ useTauriPlatform: () => fixture.platform }));
vi.mock("@/lib/use-viewport", () => ({ useIsCoarsePointer: () => false }));
vi.mock("@/lib/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: fixture.announce }) }));
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
  onData() {} onReplayReset() {} onExit() {} onClose() {} resize() {}
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
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = undefined;
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

// The Coding Desk's cap on live shells leaves a shell another terminal shows,
// such as Chat's rail, to that terminal's owner (#5795).
test("a terminal says which thread it shows while mounted, and only then", async () => {
  fixture.platform = "desktop";
  expect(terminalThreadMounted("cave.rail.shown")).toBe(false);
  let second;
  await act(async () => {
    renderer = create(<BottomTerminal threadId="cave.rail.shown" />, { createNodeMock: () => ({}) });
    second = create(<BottomTerminal threadId="cave.rail.shown" />, { createNodeMock: () => ({}) });
  });
  expect(terminalThreadMounted("cave.rail.shown")).toBe(true);
  await act(async () => second.unmount());
  expect(terminalThreadMounted("cave.rail.shown"), "one of two still shows it").toBe(true);
  await act(async () => renderer.unmount());
  renderer = undefined;
  expect(terminalThreadMounted("cave.rail.shown")).toBe(false);
});
