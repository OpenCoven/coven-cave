// @ts-expect-error -- the repository's renderer dependency has no declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { InboxItem } from "@/lib/cave-inbox";
import { RITUAL_FINISHED_PAGE, RitualFinishedGroup } from "./ritual-overview";

const finished = (index: number): InboxItem => ({
  id: `f${index}`,
  kind: "agent",
  title: `Nova finished: chat ${index}`,
  status: "fired",
  auto: "session-finished",
  familiarId: "nova",
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
  firedAt: "2026-10-08T10:00:00Z",
  recurrence: { type: "none" },
  source: "agent",
} as InboxItem);

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

function render(items: InboxItem[], props: Partial<Parameters<typeof RitualFinishedGroup>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onDismiss: vi.fn(), onDismissAll: vi.fn() };
  act(() => {
    renderer = create(<RitualFinishedGroup items={items} familiarLabel={(id) => (id ? "Nova" : null)} {...handlers} {...props} />);
  });
  return handlers;
}

const text = (node: { children?: unknown[] } | string): string =>
  typeof node === "string" ? node : (node.children ?? []).map((child) => text(child as never)).join("");
const buttons = () => renderer.root.findAll((node: { type: unknown }) => node.type === "button");
const byLabel = (label: string) => renderer.root.find((node: { props: { "aria-label"?: string } }) => node.props["aria-label"] === label);
const toggle = () => renderer.root.find((node: { type: unknown; props: { "aria-expanded"?: boolean } }) => node.type === "button" && node.props["aria-expanded"] !== undefined);

test("one collapsed row names the count and the newest, with Dismiss all (#5873)", () => {
  const items = Array.from({ length: 3 }, (_, index) => finished(index));
  const handlers = render(items);
  expect(toggle().props["aria-expanded"]).toBe(false);
  expect(text(toggle())).toContain("Finished · 3");
  expect(text(toggle())).toContain("Nova finished: chat 0");
  expect(renderer.root.findAll((node: { type: unknown }) => node.type === "ul")).toHaveLength(0);
  act(() => byLabel("Dismiss all 3 finished chats").props.onClick());
  expect(handlers.onDismissAll).toHaveBeenCalledWith(items);
});

test("opening lists a page at a time, each with Open and Dismiss", () => {
  const items = Array.from({ length: RITUAL_FINISHED_PAGE + 5 }, (_, index) => finished(index));
  const handlers = render(items);
  act(() => toggle().props.onClick());
  expect(toggle().props["aria-expanded"]).toBe(true);
  const rows = () => renderer.root.findAll((node: { props: { className?: string }; type: unknown }) => node.type === "li" && node.props.className === "rituals-overview__need-row");
  expect(rows()).toHaveLength(RITUAL_FINISHED_PAGE);
  const more = buttons().find((button: never) => text(button).startsWith("Show "));
  expect(text(more)).toBe("Show 5 more of 5");
  act(() => more.props.onClick());
  expect(rows()).toHaveLength(RITUAL_FINISHED_PAGE + 5);
  expect(buttons().some((button: never) => text(button).startsWith("Show "))).toBe(false);

  act(() => byLabel("Dismiss Nova finished: chat 2").props.onClick());
  expect(handlers.onDismiss).toHaveBeenCalledWith(items[2]);
  const open = buttons().find((button: never) => text(button).includes("Nova finished: chat 4") && !text(button).startsWith("Finished"));
  act(() => open.props.onClick());
  expect(handlers.onSelect).toHaveBeenCalledWith(items[4]);
});

test("a busy group says so and doesn't dismiss twice; an empty group renders nothing", () => {
  const items = [finished(0)];
  const handlers = render(items, { busy: true });
  const dismissing = byLabel("Dismissing 1 finished chat");
  expect(text(dismissing)).toContain("Dismissing…");
  act(() => dismissing.props.onClick());
  expect(handlers.onDismissAll).not.toHaveBeenCalled();
  act(() => renderer.update(<RitualFinishedGroup items={[]} familiarLabel={() => null} onSelect={vi.fn()} onDismiss={vi.fn()} onDismissAll={vi.fn()} />));
  expect(renderer.toJSON()).toBeNull();
});
