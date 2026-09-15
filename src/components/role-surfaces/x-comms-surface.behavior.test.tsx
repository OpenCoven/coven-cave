// @ts-nocheck
// The X Comms room's wiring. The rules it enforces live in
// src/lib/x-comms-model.test.ts; what is checked here is what the model cannot
// see — what the room actually does when someone approves, discards, undoes, or
// asks Trends to write something down, and the two promises the room makes in
// its own copy: that nothing reaches X, and that Trends never touches a body.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: () => createElement("span"),
}));

// react-test-renderer produces no real DOM nodes, and this suite runs under
// vitest's default Node environment like its x-publish-panel sibling. The room
// only touches `document` to bind its keyboard shortcuts, so a listener-shaped
// stub is enough; `requestAnimationFrame` is used to move focus after a jump.
const listeners: Record<string, Array<(event: unknown) => void>> = {};
globalThis.document = {
  body: {},
  addEventListener: (type: string, handler: (event: unknown) => void) => {
    (listeners[type] ??= []).push(handler);
  },
  removeEventListener: (type: string, handler: (event: unknown) => void) => {
    listeners[type] = (listeners[type] ?? []).filter((entry) => entry !== handler);
  },
};
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};
globalThis.cancelAnimationFrame = () => {};

// The room measures the viewport to decide whether the dispatch rail is a
// column or a tab strip, so the window is part of its real environment rather
// than something to guard away. `setViewport` re-runs the listeners the way a
// resize would.
const windowListeners: Record<string, Array<() => void>> = {};
globalThis.window = {
  innerWidth: 1600,
  addEventListener: (type: string, handler: () => void) => {
    (windowListeners[type] ??= []).push(handler);
  },
  removeEventListener: (type: string, handler: () => void) => {
    windowListeners[type] = (windowListeners[type] ?? []).filter((entry) => entry !== handler);
  },
};

async function setViewport(width: number) {
  globalThis.window.innerWidth = width;
  await act(async () => {
    for (const handler of windowListeners.resize ?? []) handler();
  });
}

import { LiveRegionProvider } from "@/components/ui/live-region";
import { XCommsSurface } from "./x-comms-surface";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONTEXT = {
  activeFamiliar: { id: "echo", name: "Echo", xPublishEnabled: true },
  activePerson: null,
  currentThread: null,
  runtimeState: {},
  memory: {},
  tools: { listTools: async () => [] },
  plugins: { listPlugins: async () => [] },
  openUrl: () => {},
  openSession: () => {},
  focusCard: () => {},
  refreshTasks: () => {},
};

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  for (const key of Object.keys(windowListeners)) delete windowListeners[key];
  globalThis.window.innerWidth = 1600;
});

async function render() {
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(LiveRegionProvider, null, createElement(XCommsSurface, { context: CONTEXT })),
    );
  });
  return renderer;
}

/**
 * The ROOM's own subtree, never the whole tree.
 *
 * `renderer.toJSON()` also carries the announcer's live regions, and this room
 * announces every mutation it makes. Asserting over the whole tree would pass
 * on the announcement alone and say nothing about what a person sees — the
 * same trap the x-publish-panel suite documents having verified by mutation.
 */
function roomText(renderer): string {
  const tree = renderer.toJSON();
  const roots = Array.isArray(tree) ? tree : [tree];
  return JSON.stringify(roots.filter((node) => node?.props?.className?.startsWith?.("x-comms")));
}

/**
 * The rendered text under an element.
 *
 * `JSON.stringify(node.props.children)` is the obvious thing to reach for and
 * throws: a React element's props carry context Providers that close a cycle.
 */
function textOf(node): string {
  const parts: string[] = [];
  const walk = (child: unknown) => {
    if (child == null || typeof child === "boolean") return;
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
      return;
    }
    if (Array.isArray(child)) {
      for (const entry of child) walk(entry);
      return;
    }
    if (typeof child === "object" && "props" in (child as Record<string, unknown>)) {
      walk((child as { props?: { children?: unknown } }).props?.children);
    }
  };
  walk(node?.props?.children);
  return parts.join(" ");
}

function byClass(renderer, className: string) {
  return renderer.root.findAll(
    (node) => typeof node.props?.className === "string" && node.props.className.split(" ").includes(className),
  );
}

/** The queue row whose title matches, as its clickable open button. */
function queueRow(renderer, titleFragment: string) {
  return byClass(renderer, "x-comms-row-open").find((node) =>
    String(node.props.title ?? "").includes(titleFragment),
  );
}

function buttonByText(renderer, text: string) {
  return renderer.root.findAll((node) => {
    if (node.type !== "button") return false;
    return textOf(node).includes(text);
  });
}

// ── The room's standing promises ────────────────────────────────────────────

test("the room says up front that nothing reaches X", async () => {
  const renderer = await render();
  const text = roomText(renderer);
  expect(text).toContain("Demo room.");
  expect(text).toContain("nothing reaches X");
  // And it points at where the real path lives, so the disclaimer is a
  // redirection rather than a dead end.
  expect(text).toContain("Live publishing");
});

test("no request leaves the room", async () => {
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as typeof fetch;
  const renderer = await render();
  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  await act(async () => approve.props.onClick());
  expect(fetchSpy).not.toHaveBeenCalled();
});

// ── Approval ────────────────────────────────────────────────────────────────

test("approving from the queue row schedules it and says where it landed", async () => {
  const renderer = await render();
  // The seeded reply is the one draft awaiting approval.
  expect(roomText(renderer)).toContain("Reply to @sarahdev");

  const pairsBefore = byClass(renderer, "x-comms-inline-action").length;
  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  expect(approve.props.disabled).toBe(false);
  await act(async () => approve.props.onClick());

  const text = roomText(renderer);
  expect(text).toContain("approved · queued for");
  // It left "Needs you": the inline approve/decline pair only renders on a row
  // awaiting approval, so approving one row retires exactly that pair.
  expect(byClass(renderer, "x-comms-inline-action")).toHaveLength(pairsBefore - 2);
  // And it is now carrying a slot it did not have before.
  expect(text).toContain("posts in");
});

test("a blocked draft's inline approve is disabled and says why", async () => {
  const renderer = await render();
  // Break the seeded reply's destination; the room rule is now unsatisfiable.
  const target = byClass(renderer, "x-comms-bare-input")[0];
  await act(async () => target.props.onChange({ target: { value: "not-a-url" } }));

  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  expect(approve.props.disabled).toBe(true);
  expect(approve.props.title).toContain("fix the destination");
});

test("the composer's own primary refuses with the same reason", async () => {
  const renderer = await render();
  const target = byClass(renderer, "x-comms-bare-input")[0];
  await act(async () => target.props.onChange({ target: { value: "not-a-url" } }));
  expect(roomText(renderer)).toContain("fix the destination to continue");
});

// ── Undo ────────────────────────────────────────────────────────────────────

test("undo puts the draft back where it was", async () => {
  const renderer = await render();
  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  await act(async () => approve.props.onClick());
  expect(roomText(renderer)).toContain("approved · queued for");

  const undo = byClass(renderer, "x-comms-toast-undo")[0];
  await act(async () => undo.props.onClick());

  // The toast is gone and the row is awaiting approval again, which means the
  // inline pair is back on it.
  expect(byClass(renderer, "x-comms-toast-undo")).toHaveLength(0);
  const restored = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  expect(restored).toBeTruthy();
});

// ── Destructive actions ─────────────────────────────────────────────────────

test("discard asks inside the card before it removes anything", async () => {
  const renderer = await render();
  const before = byClass(renderer, "x-comms-row-open").length;

  await act(async () => byClass(renderer, "x-comms-discard")[0].props.onClick());
  // Nothing is gone yet — the card asks first.
  expect(byClass(renderer, "x-comms-row-open")).toHaveLength(before);
  expect(roomText(renderer)).toContain("Discard this draft?");

  const keep = buttonByText(renderer, "Keep")[0];
  await act(async () => keep.props.onClick());
  expect(byClass(renderer, "x-comms-row-open")).toHaveLength(before);

  await act(async () => byClass(renderer, "x-comms-discard")[0].props.onClick());
  const discard = buttonByText(renderer, "Discard")[0];
  await act(async () => discard.props.onClick());
  expect(byClass(renderer, "x-comms-row-open")).toHaveLength(before - 1);
});

// ── The Trends boundary ─────────────────────────────────────────────────────

test("inserting a trend reference writes to notes and never to the body", async () => {
  const renderer = await render();

  // The selected draft's body, before.
  const composerText = byClass(renderer, "x-comms-textarea")[0].props.value;

  // Open Trends, expand the first topic, insert it.
  const trendsTab = renderer.root.findAll(
    (node) => node.props?.role === "tab" && textOf(node).includes("Trends"),
  )[0];
  await act(async () => trendsTab.props.onClick());
  await act(async () => byClass(renderer, "x-comms-trend-toggle")[0].props.onClick());
  await act(async () => byClass(renderer, "x-comms-insert-ref")[0].props.onClick());

  // Back to Approval so the composer is on screen with its notes field.
  const notes = byClass(renderer, "x-comms-notes")[0];
  const notesInput = notes.findAll((node) => node.type === "input")[0];

  expect(notesInput.props.value).toContain("ref: agent hand-offs");
  // The load-bearing half: the post body is untouched.
  expect(byClass(renderer, "x-comms-textarea")[0].props.value).toBe(composerText);
  expect(roomText(renderer)).toContain("body untouched");
});

// ── Composer wiring ─────────────────────────────────────────────────────────

test("converting a post to a thread keeps what was already written", async () => {
  const renderer = await render();
  const original = byClass(renderer, "x-comms-textarea")[0].props.value;
  expect(original.length).toBeGreaterThan(0);

  const slashThread = byClass(renderer, "x-comms-slash").find((node) =>
    textOf(node).includes("/thread"),
  );
  await act(async () => slashThread.props.onClick());

  const areas = byClass(renderer, "x-comms-textarea");
  expect(areas.length).toBe(2);
  expect(areas[0].props.value).toBe(original);
  expect(areas[1].props.value).toBe("");
});

test("preview renders the draft and says it is not posted", async () => {
  const renderer = await render();
  const preview = renderer.root.findAll(
    (node) => node.props?.role === "radio" && node.props["aria-checked"] === false,
  );
  const toPreview = preview.find((node) =>
    textOf(node).includes("Preview"),
  );
  await act(async () => toPreview.props.onClick());

  const text = roomText(renderer);
  expect(text).toContain("rendered locally · not posted");
  expect(text).toContain("scheduler ward was re-armed");
});

test("a missing alt text is quoted in the preview, where approval is being decided", async () => {
  const renderer = await render();

  // The seeded thread carries an image; strip its alt and preview it.
  await act(async () => queueRow(renderer, "Three familiars").props.onClick());
  const alt = byClass(renderer, "x-comms-alt-input")[0];
  await act(async () => alt.props.onChange({ target: { value: "" } }));

  const toPreview = renderer.root
    .findAll((node) => node.props?.role === "radio")
    .find((node) => textOf(node).includes("Preview"));
  await act(async () => toPreview.props.onClick());

  expect(roomText(renderer)).toContain("alt: missing — blocks approval");
});

// ── Account-level states ────────────────────────────────────────────────────

/** Flip the demo account-state switch to one of its three values. */
async function setAccountState(renderer, value: string) {
  const group = byClass(renderer, "x-comms-segmented").find(
    (node) => node.props["aria-label"] === "Demo account state",
  );
  const option = group.findAll((node) => node.props?.role === "radio").find(
    (node) => textOf(node) === value,
  );
  await act(async () => option.props.onClick());
}

test("a disconnected account blocks approval and says what happens to the queue", async () => {
  const renderer = await render();
  await setAccountState(renderer, "disconnected");

  const text = roomText(renderer);
  expect(text).toContain("X disconnected.");
  // The promise the state has to keep: work is not lost, it is held.
  expect(text).toContain("posts hold locally");
  expect(text).toContain("nothing drops");

  // And approval keeps working, which is what makes that promise true — the
  // queue exists to be filled while the account is away. A gate here would
  // mean nothing could ever be waiting for the reconnect.
  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  expect(approve.props.disabled).toBe(false);
  const pairsBefore = byClass(renderer, "x-comms-inline-action").length;
  await act(async () => approve.props.onClick());
  expect(byClass(renderer, "x-comms-inline-action")).toHaveLength(pairsBefore - 2);
  expect(roomText(renderer)).toContain("approved · queued for");
});

test("a spent API budget is shown as spent, and still does not lose the queue", async () => {
  const renderer = await render();
  await setAccountState(renderer, "rate-limited");

  const text = roomText(renderer);
  expect(text).toContain("API budget spent.");
  expect(text).toContain("scheduled posts wait for the reset");
  // The meter reads zero rather than merely turning red.
  expect(text).toContain("api 0 left");
});

test("the failed and slot-passed states are reachable, and each says what did NOT happen", async () => {
  const renderer = await render();

  await act(async () => queueRow(renderer, "The write-up is live").props.onClick());
  let text = roomText(renderer);
  expect(text).toContain("post failed");
  expect(text).toContain("403 · duplicate content");
  // The part an operator needs most: X refused, so nothing went out.
  expect(text).toContain("Nothing was posted.");
  expect(buttonByText(renderer, "Retry at next slot").length).toBeGreaterThan(0);

  await act(async () => queueRow(renderer, "Office hours").props.onClick());
  text = roomText(renderer);
  expect(text).toContain("slot passed");
  expect(text).toContain("Approving picks the next");
});

test("merging two posts refuses rather than quietly dropping an attachment", async () => {
  const renderer = await render();
  await act(async () => queueRow(renderer, "Three familiars").props.onClick());

  // Post 2 of the seeded thread carries an image; give post 1 a poll so the
  // pair cannot legally combine.
  const addPoll = renderer.root
    .findAll((node) => node.type === "button" && textOf(node) === "+poll")
    .find((node) => !node.props.disabled);
  await act(async () => addPoll.props.onClick());

  const mergeDown = renderer.root
    .findAll((node) => node.type === "button" && textOf(node).startsWith("merge"))
    .find((node) => !node.props.disabled);
  await act(async () => mergeDown.props.onClick());

  // Said, not done: the poll and the image both survive.
  expect(roomText(renderer)).toContain("can't merge");
  expect(byClass(renderer, "x-comms-poll").length).toBeGreaterThan(0);
  expect(byClass(renderer, "x-comms-media").length).toBeGreaterThan(0);
});

// ── The queue ───────────────────────────────────────────────────────────────

test("the state of each row is readable without relying on colour", async () => {
  const renderer = await render();
  // Every status dot is paired with its label in text for assistive tech; the
  // room shows six states and hue alone cannot carry them.
  const text = roomText(renderer);
  expect(text).toContain("awaiting approval");
  expect(text).toContain("approved · scheduled");
  expect(text).toContain("posted");
});

test("below 1280 the dispatch rail becomes a tab strip that opens as an overlay", async () => {
  const renderer = await render();
  // Wide: the rail is a column and there is no strip.
  expect(byClass(renderer, "x-comms-dispatch")).toHaveLength(1);
  expect(byClass(renderer, "x-comms-rail-tabs")).toHaveLength(0);

  await setViewport(1100);
  // Narrow: the strip replaces it, and the rail is closed until asked for.
  expect(byClass(renderer, "x-comms-rail-tabs")).toHaveLength(1);
  expect(byClass(renderer, "x-comms-dispatch")).toHaveLength(0);
  expect(byClass(renderer, "x-comms")[0].props["data-rail"]).toBe("collapsed");

  // The strip carries the same amber badge the wide tablist does, so the one
  // thing awaiting a decision is still visible when the rail is not.
  const approvalTab = byClass(renderer, "x-comms-rail-tab")[0];
  expect(approvalTab.props["aria-label"]).toBe("Approval");
  expect(approvalTab.findAll((node) => node.props?.className === "x-comms-badge")).toHaveLength(1);

  await act(async () => approvalTab.props.onClick());
  expect(byClass(renderer, "x-comms-dispatch")).toHaveLength(1);
  // Pressing the same tab again puts it away.
  await act(async () => byClass(renderer, "x-comms-rail-tab")[0].props.onClick());
  expect(byClass(renderer, "x-comms-dispatch")).toHaveLength(0);
});

test("the queue resizes from the keyboard, not only by dragging", async () => {
  const renderer = await render();
  const handle = byClass(renderer, "x-comms-resize")[0];
  expect(handle.props.role).toBe("separator");

  const room = byClass(renderer, "x-comms")[0];
  const before = room.props.style["--x-queue-w"];
  await act(async () =>
    handle.props.onKeyDown({ key: "ArrowRight", shiftKey: false, preventDefault: () => {} }),
  );
  expect(byClass(renderer, "x-comms")[0].props.style["--x-queue-w"]).not.toBe(before);
});


test("Live publishing opens the real familiar-scoped panel without dispatching a write", async () => {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, publications: [] }),
  }));
  globalThis.fetch = fetchSpy as typeof fetch;
  const renderer = await render();
  expect(fetchSpy).not.toHaveBeenCalled();
  const approve = byClass(renderer, "x-comms-inline-action").find(
    (node) => node.props["data-variant"] === "approve",
  );
  await act(async () => approve.props.onClick());
  const approvalsAfter = byClass(renderer, "x-comms-inline-action").filter(
    (node) => node.props["data-variant"] === "approve",
  ).length;
  await act(async () => buttonByText(renderer, "Live publishing")[0].props.onClick());
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe("/api/x/publish?familiarId=echo");
  expect(fetchSpy.mock.calls[0][1]?.method ?? "GET").toBe("GET");
  expect(renderer.root.findAllByProps({ "aria-label": "Live X publishing" })).toHaveLength(1);
  await act(async () => buttonByText(renderer, "Back to demo planning")[0].props.onClick());
  expect(roomText(renderer)).toContain("Demo room.");
  expect(byClass(renderer, "x-comms-inline-action").filter(
    (node) => node.props["data-variant"] === "approve",
  )).toHaveLength(approvalsAfter);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});
