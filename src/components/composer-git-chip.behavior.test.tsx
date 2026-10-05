// @ts-nocheck — react-test-renderer has no declarations in this repository.
// useBranchPr reads the branch's PR again after a desk action changes it and
// on a slow poll (#5795). It was read once per (root, branch), so after
// Create PR the composer kept saying there was none, and after a merge, "open".
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useBranchPr } from "./composer-git-chip";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/lib/use-changes-summary", () => ({ useChangesSummary: () => ({}) }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: () => {} }) }));
vi.mock("@/components/ui/popover", () => ({
  Popover: () => null,
  PopoverBody: () => null,
  PopoverItem: () => null,
  PopoverLabel: () => null,
  PopoverSeparator: () => null,
  usePopoverEscapeLayer: () => {},
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fixture = { answer: { ok: true, pr: null }, status: 200, urls: [] };
const seen = [];
let renderer;

function Probe({ root, branch }) {
  seen.push(useBranchPr(root, branch));
  return null;
}

const last = () => seen[seen.length - 1];
const flush = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
});
const pr = (number, state = "OPEN") => ({ number, url: `https://github.com/acme/alpha/pull/${number}`, state, isDraft: false });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  seen.length = 0;
  fixture.urls = [];
  fixture.answer = { ok: true, pr: null };
  fixture.status = 200;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", {
    hidden: false,
    visibilityState: "visible",
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    fixture.urls.push(String(url));
    const answer = fixture.answer;
    return { ok: fixture.status < 400, status: fixture.status, json: async () => answer };
  }));
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a desk action that changes the branch's PR is read at once, and a slow poll catches the rest", async () => {
  await act(async () => {
    renderer = create(<Probe root="/repo/alpha" branch="cave/desk-1" />);
  });
  await flush();
  expect(fixture.urls).toEqual(["/api/changes?projectRoot=%2Frepo%2Falpha&pr=1"]);
  expect(last()).toBeNull();

  // Create PR or a merge dispatches the event: the new PR shows without a remount.
  fixture.answer = { ok: true, pr: pr(12) };
  await act(async () => {
    window.dispatchEvent(new CustomEvent("cave:branch-pr-changed"));
  });
  await flush();
  expect(fixture.urls).toHaveLength(2);
  expect(last()).toEqual(pr(12));

  // A re-render from the 5s status poll reads nothing.
  await act(async () => {
    renderer.update(<Probe root="/repo/alpha" branch="cave/desk-1" />);
  });
  await flush();
  expect(fixture.urls).toHaveLength(2);

  // The slow poll picks up a merge made elsewhere.
  fixture.answer = { ok: true, pr: pr(12, "MERGED") };
  await act(async () => {
    vi.advanceTimersByTime(59_000);
  });
  await flush();
  expect(fixture.urls).toHaveLength(2);
  await act(async () => {
    vi.advanceTimersByTime(1_000);
  });
  await flush();
  expect(fixture.urls).toHaveLength(3);
  expect(last()).toEqual(pr(12, "MERGED"));

  // A failed re-read keeps what's shown.
  fixture.answer = { ok: false, error: "git unavailable" };
  fixture.status = 500;
  await act(async () => {
    window.dispatchEvent(new CustomEvent("cave:branch-pr-changed"));
  });
  await flush();
  expect(fixture.urls).toHaveLength(4);
  expect(last()).toEqual(pr(12, "MERGED"));
});

test("a branch switch never shows the previous branch's PR while the new one is read", async () => {
  fixture.answer = { ok: true, pr: pr(7) };
  await act(async () => {
    renderer = create(<Probe root="/repo/alpha" branch="feat/flux" />);
  });
  await flush();
  expect(last()).toEqual(pr(7));

  fixture.answer = { ok: true, pr: null };
  const before = seen.length;
  await act(async () => {
    renderer.update(<Probe root="/repo/alpha" branch="main" />);
  });
  await flush();
  // Not before the new answer lands, nor after it.
  expect(seen.slice(before)).not.toContainEqual(pr(7));
  expect(last()).toBeNull();
  expect(fixture.urls).toHaveLength(2);
});

test("no root, no branch or a detached HEAD reads nothing and listens for nothing", async () => {
  await act(async () => {
    renderer = create(<Probe root={undefined} branch="main" />);
  });
  await act(async () => {
    renderer.update(<Probe root="/repo/alpha" branch="HEAD" />);
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent("cave:branch-pr-changed"));
    vi.advanceTimersByTime(120_000);
  });
  await flush();
  expect(fixture.urls).toEqual([]);
  expect(last()).toBeNull();
});
