// @ts-nocheck — react-test-renderer ships no types; matches the other
// *.behavior.test.tsx files.
//
// The bell's Notifications popover (#6483), driven through the REAL component:
// what it renders and which requests it sends. This repo has no jsdom, so the
// few browser globals the component touches are stubbed below, and the focus
// trap (covered by its own tests) is replaced with a no-op.

import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: ({ name }) => <span data-icon={name} />,
  CAVE_ICON_SIZE: { headerAction: 18 },
}));
vi.mock("@/lib/use-focus-trap", () => ({ useFocusTrap: () => {} }));
vi.mock("@/lib/tauri-platform", () => ({ isMacDesktopShell: () => false }));
vi.mock("@/lib/use-minute-tick", () => ({ useMinuteTick: () => 0 }));
vi.mock("@/lib/datetime-format", () => ({ useDateTimePrefs: () => ({}) }));
vi.mock("@/components/ui/relative-time", () => ({ RelativeTime: ({ iso }) => <time>{String(iso)}</time> }));

import { NotificationBell } from "./notification-bell";
import { LiveRegionProvider } from "@/components/ui/live-region";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const daysAgo = (days, hour = 21) => {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const base = {
  createdAt: iso(600),
  updatedAt: iso(600),
  fireAt: null,
  snoozeUntil: null,
  recurrence: { type: "none" },
  source: "system",
  readAt: null,
};
const waiting = {
  ...base,
  id: "eph:response-needed:sage",
  kind: "response-needed",
  title: "Sage needs a reply",
  status: "pending",
  firedAt: null,
  familiarId: "sage",
  sessionId: "s1",
};
const due = { ...base, id: "due", kind: "reminder", title: "Stretch", status: "fired", fireAt: iso(30), firedAt: iso(30) };
const update = {
  ...base,
  id: "update",
  kind: "agent",
  title: "Nova finished the sweep",
  body: "Line one\nLine two",
  status: "fired",
  firedAt: iso(5),
  familiarId: "nova",
};
const report = (days, read = false) => ({
  ...base,
  id: `report-${days}`,
  kind: "daily-summary",
  title: `Daily summary · ${days}`,
  status: "fired",
  firedAt: daysAgo(days),
  auto: `daily-summary:2026-11-${String(12 - days).padStart(2, "0")}`,
  link: { kind: "url", ref: `/daily-report/2026-11-${String(12 - days).padStart(2, "0")}` },
  readAt: read ? iso(1) : null,
  media: { stats: { reminders: 0, responses: 0, familiars: 0, sessions: 24, prsMerged: 61 } },
});

const prefs = { sound: { mode: "default" }, mutedKinds: [], mutedFamiliars: [] };
const familiars = [
  { id: "sage", display_name: "Sage" },
  { id: "nova", display_name: "Nova" },
];

let tree;
let fetchCalls;
let onOpenItem;
let onOpenInbox;

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  return (node.children ?? []).map(textOf).join("");
}
const allText = () => textOf(tree.root);
const buttonByLabel = (label) =>
  tree.root.findAll((n) => n.type === "button" && n.props["aria-label"] === label);
const buttonByText = (text) =>
  tree.root.findAll((n) => n.type === "button" && textOf(n).trim() === text);
const bodies = () => fetchCalls.map(([url, init]) => ({ url, body: init?.body ? JSON.parse(init.body) : null }));

async function mount(items) {
  await act(async () => {
    tree = create(
      <LiveRegionProvider>
        <NotificationBell
          items={items}
          familiars={familiars}
          prefs={prefs}
          onOpenInbox={onOpenInbox}
          onOpenItem={onOpenItem}
          onPrefsChanged={() => {}}
        />
      </LiveRegionProvider>,
    );
  });
  const trigger = tree.root.find((n) => n.type === "button" && n.props["aria-haspopup"] === "dialog");
  await act(async () => trigger.props.onClick());
}

async function click(node) {
  await act(async () => {
    node.props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
}

beforeEach(() => {
  fetchCalls = [];
  onOpenItem = vi.fn();
  onOpenInbox = vi.fn();
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push([url, init]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
  globalThis.document = { activeElement: null };
  globalThis.requestAnimationFrame = (fn) => {
    fn(0);
    return 0;
  };
  globalThis.CSS = { escape: (value) => value };
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
});

test("needs you leads, and four daily reports fold into one row", async () => {
  await mount([report(0), report(1), report(2), report(3), update, due, waiting]);

  const headings = tree.root.findAll((n) => n.type === "h3").map((h) => textOf(h).replace(/\d+$/, "").trim());
  expect(headings[0]).toBe("Needs you");
  expect(headings).toContain("Today");

  const needs = tree.root.find((n) => n.type === "section" && String(n.props.className).includes("--needs"));
  const needsText = textOf(needs);
  expect(needsText).toContain("Sage needs a reply");
  expect(needsText).toContain("Stretch");
  expect(needsText).not.toContain("Daily summary");

  const reportRows = tree.root.findAll((n) => n.type === "li" && n.props["data-kind"] === "daily-summary");
  expect(reportRows).toHaveLength(1);
  expect(textOf(reportRows[0])).toContain("3 earlier reports folded in");
  expect(textOf(reportRows[0])).toContain("Daily summary · 0");
});

test("opening a folded report opens the newest and reads the rest", async () => {
  await mount([report(0), report(1, true), report(2)]);
  const row = tree.root.find((n) => n.type === "li" && n.props["data-kind"] === "daily-summary");
  const open = row.find((n) => n.type === "button" && String(n.props.className).includes("notification-row__open"));
  await click(open);
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: "report-0" }));
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "read", ids: ["report-2"] } });
  expect(tree.root.findAll((n) => n.props?.role === "dialog")).toHaveLength(0);
});

test("a waiting reply has no dismiss, read or snooze controls", async () => {
  await mount([waiting]);
  expect(buttonByLabel("Dismiss: Sage needs a reply")).toHaveLength(0);
  expect(buttonByLabel("Mark read: Sage needs a reply")).toHaveLength(0);
  expect(buttonByLabel("Snooze: Sage needs a reply")).toHaveLength(0);
  expect(buttonByLabel("More actions: Sage needs a reply")).toHaveLength(0);
  expect(allText()).toContain("Waiting on you");
});

test("dismiss offers Undo, which restores the item and makes it unread again", async () => {
  await mount([update]);
  await click(buttonByLabel("Dismiss: Nova finished the sweep")[0]);
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "dismiss", ids: ["update"] } });
  expect(allText()).toContain("Dismissed “Nova finished the sweep”");

  fetchCalls = [];
  await click(buttonByText("Undo")[0]);
  expect(bodies()).toEqual([
    { url: "/api/inbox/bulk", body: { action: "restore", ids: ["update"] } },
    { url: "/api/inbox/bulk", body: { action: "unread", ids: ["update"] } },
  ]);
  expect(buttonByText("Undo")).toHaveLength(0);
});

test("clear all is one bulk dismiss, and Undo restores exactly what it cleared", async () => {
  await mount([update, { ...due, readAt: iso(1) }, waiting]);
  await click(buttonByText("Clear all")[0]);
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "dismiss", all: true } });
  expect(allText()).toContain("Cleared 2 notifications");

  fetchCalls = [];
  await click(buttonByText("Undo")[0]);
  expect(bodies()).toEqual([
    { url: "/api/inbox/bulk", body: { action: "restore", ids: ["update", "due"] } },
    { url: "/api/inbox/bulk", body: { action: "unread", ids: ["update"] } },
  ]);
});

test("snooze offers the shared durations and sends the one chosen", async () => {
  await mount([due]);
  await click(buttonByLabel("Snooze: Stretch")[0]);
  const choices = tree.root.find((n) => n.props?.role === "group" && n.props["aria-label"] === "Snooze Stretch for");
  expect(textOf(choices)).toContain("Tomorrow 9am");
  await click(buttonByText("30 min")[0]);
  expect(bodies()).toContainEqual({ url: "/api/inbox/due/snooze", body: { minutes: 30 } });
  expect(tree.root.findAll((n) => n.props?.role === "group" && n.props["aria-label"] === "Snooze Stretch for")).toHaveLength(0);
});

test("Escape closes the snooze choices, not the popover", async () => {
  await mount([due]);
  await click(buttonByLabel("Snooze: Stretch")[0]);
  const choices = tree.root.find((n) => n.props?.role === "group" && n.props["aria-label"] === "Snooze Stretch for");
  const stop = vi.fn();
  await act(async () => choices.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation: stop }));
  expect(stop).toHaveBeenCalled();
  expect(tree.root.findAll((n) => n.props?.role === "group" && n.props["aria-label"] === "Snooze Stretch for")).toHaveLength(0);
  expect(tree.root.findAll((n) => n.props?.role === "dialog")).toHaveLength(1);
});

test("read and unread are one toggle with a state-aware name", async () => {
  await mount([update, { ...due, readAt: iso(1) }]);
  await click(buttonByLabel("Mark read: Nova finished the sweep")[0]);
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "read", ids: ["update"] } });
  await click(buttonByLabel("Mark unread: Stretch")[0]);
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "unread", ids: ["due"] } });
});

test("on phones, More opens the row's labeled actions, and Escape closes them", async () => {
  await mount([update]);
  const more = buttonByLabel("More actions: Nova finished the sweep")[0];
  expect(more.props["aria-expanded"]).toBe(false);
  await click(more);
  const sheet = () =>
    tree.root.findAll((n) => n.props?.role === "group" && n.props["aria-label"] === "Actions for Nova finished the sweep");
  expect(sheet()).toHaveLength(1);
  expect(textOf(sheet()[0])).toContain("Mark read");
  expect(textOf(sheet()[0])).toContain("Snooze…");
  expect(textOf(sheet()[0])).toContain("Mute Nova");

  const stop = vi.fn();
  await act(async () => sheet()[0].props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation: stop }));
  expect(stop).toHaveBeenCalled();
  expect(sheet()).toHaveLength(0);

  await click(buttonByLabel("More actions: Nova finished the sweep")[0]);
  await click(sheet()[0].find((n) => n.type === "button" && textOf(n) === "Dismiss"));
  expect(bodies()).toContainEqual({ url: "/api/inbox/bulk", body: { action: "dismiss", ids: ["update"] } });
  expect(sheet()).toHaveLength(0);
});

test("Snooze from the phone actions opens the same durations", async () => {
  await mount([due]);
  await click(buttonByLabel("More actions: Stretch")[0]);
  await click(buttonByText("Snooze…")[0]);
  expect(tree.root.findAll((n) => n.props?.role === "group" && n.props["aria-label"] === "Snooze Stretch for")).toHaveLength(1);
});

test("an empty bell says you're caught up and still leads to Rituals", async () => {
  await mount([]);
  expect(allText()).toContain("You're all caught up");
  expect(buttonByText("Clear all")).toHaveLength(0);
  expect(buttonByText("Mark all read")).toHaveLength(0);
  const footer = tree.root.find((n) => n.type === "button" && String(n.props.className).includes("notification-bell__open-inbox"));
  await click(footer);
  expect(onOpenInbox).toHaveBeenCalled();
});

test("a failed dismiss offers no Undo", async () => {
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push([url, init]);
    return { ok: false, status: 500, json: async () => ({}) };
  });
  await mount([update]);
  await click(buttonByLabel("Dismiss: Nova finished the sweep")[0]);
  expect(buttonByText("Undo")).toHaveLength(0);
});
