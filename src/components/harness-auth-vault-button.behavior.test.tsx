// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React, { useState } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { HarnessAuthVaultButton } from "./harness-auth-vault-button";

vi.mock("next/dynamic", () => ({ default: () => (props) => <section data-vault={props.familiarId} /> }));
vi.mock("./ui/modal", () => ({ Modal: ({ children, onClose }) => <div role="dialog"><button onClick={onClose}>Close</button>{children}</div> }));
vi.mock("./ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("Vault recovery preserves the mounted failed request and its retry payload", async () => {
  const retry = vi.fn();
  const request = { text: "original prompt", attachments: [{ path: "fixture.png" }], options: { modelOverride: "selected-model" } };
  let mounts = 0;
  function Chat() {
    const [failed] = useState(() => { mounts++; return request; });
    return <><HarnessAuthVaultButton familiarId="cody" className="focus-ring" /><button onClick={() => retry(failed)}>Retry</button></>;
  }
  const assign = vi.fn();
  const focus = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  let renderer;
  try {
    await act(async () => { renderer = create(<Chat />); });
    await act(async () => renderer.root.findAllByType("button")[0].props.onClick({ currentTarget: { focus } }));
    expect(focus).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ "data-vault": "cody" })).toBeTruthy();
    await act(async () => renderer.root.findByProps({ role: "dialog" }).findByType("button").props.onClick());
    expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    await act(async () => renderer.root.findAllByType("button")[1].props.onClick());
    expect(retry).toHaveBeenCalledWith(request);
    expect(mounts).toBe(1);
    expect(assign).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  }
});
