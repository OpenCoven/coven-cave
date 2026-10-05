// @ts-nocheck — react-test-renderer has no published types in this repository.
import { useEffect, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatTurnTimeline } from "./chat-turn-timeline";
import { ChatReasoningDisclosure } from "./chat-reasoning-disclosure";
import { writeShowThinking } from "@/lib/reasoning-visibility";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("chronological transcript disclosures", () => {
  it.each([undefined, "0", "1"])("honors saved preference %s even while a summary is pending", async (value) => {
    if (value !== undefined) storage.set("cave:chat:show-thinking", value);
    let tree;
    await act(async () => { tree = create(<ChatReasoningDisclosure pending summary="Summary">Safe summary</ChatReasoningDisclosure>); });
    expect(Boolean(tree.root.findByType("details").props.open)).toBe(value !== "0");
    await act(async () => tree.unmount());
  });

  it("keeps a user's expansion through text growth and completion, while global changes still apply", async () => {
    storage.set("cave:chat:show-thinking", "0");
    let tree;
    const view = (pending, text) => <ChatReasoningDisclosure pending={pending} summary="Summary">{text}</ChatReasoningDisclosure>;
    await act(async () => { tree = create(view(true, "Pending")); });
    const node = { open: true };
    await act(async () => tree.root.findByType("details").props.onToggle({ target: node, currentTarget: node }));
    await act(async () => tree.update(view(false, "Complete safe summary")));
    expect(tree.root.findByType("details").props.open).toBe(true);
    await act(async () => writeShowThinking(true));
    await act(async () => writeShowThinking(false));
    expect(tree.root.findByType("details").props.open).toBeUndefined();
    await act(async () => tree.unmount());
  });

  it("preserves tool and summary instances when prose is inserted and calls settle", async () => {
    const mounts = new Map();
    function Tool({ tool }) {
      const [open, setOpen] = useState(false);
      useEffect(() => { mounts.set(tool.id, (mounts.get(tool.id) ?? 0) + 1); }, []);
      return <button data-tool={tool.id} aria-expanded={open} onClick={() => setOpen(!open)}>{tool.status}</button>;
    }
    const summary = { kind: "reasoning", key: "reasoning:a", block: { id: "a" } };
    const call = { kind: "tool", key: "tool:a", tool: { id: "a", status: "running" } };
    const view = (entries, pending) => <ChatTurnTimeline entries={entries}
      renderText={(text) => <p>{text}</p>}
      renderTool={(tool) => <Tool tool={tool} />}
      renderReasoning={() => <ChatReasoningDisclosure pending={pending} summary="Summary">Safe summary</ChatReasoningDisclosure>} />;
    let tree;
    await act(async () => { tree = create(view([summary, call], true)); });
    await act(async () => tree.root.findByType("button").props.onClick());
    const closed = { open: false };
    await act(async () => tree.root.findByType("details").props.onToggle({ target: closed, currentTarget: closed }));
    await act(async () => tree.update(view([summary, { kind: "text", key: "prose:reasoning:a", text: "Before tool" }, { ...call, tool: { ...call.tool, status: "error" } }, { kind: "text", key: "prose:tool:a", text: "After tool" }], false)));
    expect(mounts.get("a")).toBe(1);
    expect(tree.root.findByType("button").props["aria-expanded"]).toBe(true);
    expect(tree.root.findByType("details").props.open).toBeUndefined();
    expect(tree.root.findAll((node) => node.props["data-timeline-kind"]).map((node) => node.props["data-timeline-kind"])).toEqual(["reasoning", "text", "tool", "text"]);
    await act(async () => tree.unmount());
  });
});
