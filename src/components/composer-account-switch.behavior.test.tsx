// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React, { useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ComposerRuntimePopover } from "./composer-runtime-chip";
import { BottomTerminal } from "./bottom-terminal";

const { announce } = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("next/dynamic", async () => {
  const { HarnessAuthTerminal } = await import("./harness-auth-terminal");
  return { default: () => HarnessAuthTerminal };
});
vi.mock("./bottom-terminal", () => ({ BottomTerminal: () => <div data-terminal /> }));
vi.mock("./ui/modal", () => ({ Modal: ({ children, breadcrumb, onClose }) => <div role="dialog" aria-label={breadcrumb.join(" / ")}><button onClick={onClose}>Close</button>{children}</div> }));
vi.mock("./ui/live-region", () => ({ useAnnouncer: () => ({ announce }) }));
vi.mock("./ui/popover", () => ({
  Popover: ({ open, children }) => open ? <section>{children}</section> : null,
  PopoverBody: ({ children }) => <div>{children}</div>,
  PopoverLabel: ({ children }) => <span>{children}</span>,
  PopoverSeparator: () => <hr />,
  PopoverItem: ({ children, onSelect, disabled }) => <button disabled={disabled} onClick={onSelect}>{children}</button>,
}));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("./runtime-logo", () => ({ RuntimeLogo: () => null, runtimeDisplayName: (id) => id }));
vi.mock("./model-inventory-feedback", () => ({ ModelInventoryFeedback: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; vi.clearAllMocks(); });
const switchButton = (label = "Claude") => renderer.root.findAllByType("button").find((node) => node.children.join("") === `Switch ${label} account…`);

for (const { runtime, label, command } of [
  { runtime: "claude", label: "Claude", command: "claude auth login && claude auth status --text" },
  { runtime: "codex", label: "Codex", command: "codex login && codex login status" },
]) test(`switching a ${label} account opens CLI sign-in without replacing the chat or changing runtime`, async () => {
  const pick = vi.fn();
  const focus = vi.fn();
  let mounts = 0;
  function Chat() {
    const [draft] = useState(() => { mounts++; return "keep this draft"; });
    const [open, setOpen] = useState(true);
    return <><p>{draft}</p><ComposerRuntimePopover open={open} onOpenChange={setOpen}
      anchorRef={{ current: { focus } }} runtime={runtime} executionRuntime="local" onPickRuntime={pick} /></>;
  }
  await act(async () => { renderer = create(<Chat />); });
  expect(renderer.root.findAllByType(BottomTerminal)).toHaveLength(0);
  expect(switchButton(label)).toBeTruthy();
  await act(async () => switchButton(label).props.onClick());
  expect(pick).not.toHaveBeenCalled();
  expect(focus).toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith(`Opening ${label} account sign-in.`);
  const terminal = renderer.root.findByType(BottomTerminal);
  const write = vi.fn();
  await act(async () => { terminal.props.onReady({ write }); });
  expect(write).toHaveBeenCalledExactlyOnceWith(`${command}\r`);
  // BottomTerminal calls onReady once per shell, and Retry replaces the shell:
  // the new one gets the sign-in command again (#5800).
  await act(async () => { terminal.props.onReady({ write }); });
  expect(write).toHaveBeenCalledTimes(2);
  expect(terminal.props.disposeOnUnmount).toBe(true);
  expect(renderer.root.findByProps({ role: "dialog" }).findByType("p").children.join(""))
    .toContain(`other local ${label} CLI launches, not only this chat`);
  await act(async () => renderer.root.findByProps({ role: "dialog" }).findByType("button").props.onClick());
  expect(renderer.root.findAllByType(BottomTerminal)).toHaveLength(0);
  expect(renderer.root.findByType("p").children).toEqual(["keep this draft"]);
  expect(mounts).toBe(1);
});

for (const props of [
  { runtime: "opencode", executionRuntime: "local" },
  { runtime: "claude", executionRuntime: "ssh:host:/workspace" },
  { runtime: "codex", executionRuntime: "ssh:host:/workspace" },
  { runtime: "codex", executionRuntime: null },
  { runtime: "claude", executionRuntime: "local", disabled: true },
  { runtime: "codex", executionRuntime: "local", disabled: true },
]) {
  test(`no local account action for ${JSON.stringify(props)}`, async () => {
    await act(async () => { renderer = create(<ComposerRuntimePopover open onOpenChange={() => {}}
      anchorRef={{ current: null }} onPickRuntime={() => {}} {...props} />); });
    expect(renderer.root.findAllByType("button").filter((node) => /^Switch .+ account…$/.test(node.children.join("")))).toHaveLength(0);
  });
}
