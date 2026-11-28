// @ts-nocheck
// The agent-proposal card never offers a blind Retry for a GitHub write that
// may already have landed (#6369).
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubCardComposer } from "./github-card-composer";

import { GitHubActionCard, clearViewerAuthorAnswers, fireGitHubAction, githubActionTargetUrl } from "./github-action-card";

vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("@/components/message-bubble", () => ({ MarkdownBlock: () => null }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));

const renderers = [];

const comment = { kind: "comment", repo: "o/r", number: 7, body: "Looks good." } as const;

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(async () => {
  for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

async function mount(element) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 0; });
  let renderer;
  await act(async () => { renderer = create(element); });
  renderers.push(renderer);
  return renderer;
}

function button(renderer, text) {
  return renderer.root.findAllByType("button").find((node) => node.children.join("") === text);
}

describe("fireGitHubAction", () => {
  it("returns null when the route confirms the write", async () => {
    answer(200, { ok: true, comment: { id: "1" } });
    expect(await fireGitHubAction(comment)).toBeNull();
  });

  it("marks an ambiguous-write answer as uncertain, with the route's reason", async () => {
    answer(502, {
      ok: false,
      code: "ambiguous-write",
      dispatched: true,
      error: "GitHub accepted the comment, but its answer did not confirm it. Check before trying again.",
    });
    expect(await fireGitHubAction(comment)).toEqual({
      error: "GitHub accepted the comment, but its answer did not confirm it. Check before trying again.",
      uncertain: true,
    });
  });

  it("marks a dropped connection to Cave as uncertain rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const failure = await fireGitHubAction(comment);
    expect(failure?.uncertain).toBe(true);
  });

  it("marks an unreadable answer from Cave as uncertain, even a 200", async () => {
    const answered = async (status: number, text: string) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status })));
      return fireGitHubAction(comment);
    };
    for (const [status, text] of [[200, '{"ok":tr'], [200, ""], [200, "[]"], [502, ""], [500, "<html>"]] as const) {
      expect(await answered(status, text), `${status} ${text}`).toEqual({
        error: "Cave’s answer was cut off, so this may have gone through.",
        uncertain: true,
      });
    }
  });

  it("keeps a plain 502 retryable, because Cave proved the write never left", async () => {
    answer(502, { ok: false, error: "GitHub is unreachable" });
    expect(await fireGitHubAction(comment)).toEqual({ error: "GitHub is unreachable", uncertain: false });
  });

  it.each([{ ok: false, error: { message: "drift" } }, { ok: false, code: 42 }, { ok: "true" }])("rejects a malformed write envelope: %j", async (body) => {
    answer(200, body);
    expect((await fireGitHubAction(comment))?.uncertain).toBe(true);
  });

  it("keeps a definite refusal retryable", async () => {
    answer(403, { ok: false, error: "github error (403)" });
    expect(await fireGitHubAction(comment)).toEqual({ error: "github error (403)", uncertain: false });
    answer(401, { ok: false, error: "auth_required" });
    expect(await fireGitHubAction(comment)).toEqual({ error: "connect GitHub first", uncertain: false });
  });

  it("refuses a proposal with no body before sending anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fireGitHubAction({ ...comment, body: "" })).toEqual({ error: "no comment text proposed", uncertain: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("githubActionTargetUrl", () => {
  it("points each action at the page where its outcome is visible", () => {
    expect(githubActionTargetUrl(comment)).toBe("https://github.com/o/r/issues/7");
    expect(githubActionTargetUrl({ kind: "merge", repo: "o/r", number: 9 })).toBe("https://github.com/o/r/pull/9");
    expect(githubActionTargetUrl({ kind: "dispatch", repo: "o/r", workflow: "ci.yml", ref: "main" })).toBe("https://github.com/o/r/actions");
  });
});

describe("rendered uncertain writes", () => {
  it("the proposal keeps a torn response uncertain without another dispatch", async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":', { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const renderer = await mount(<GitHubActionCard action={comment} />);
    await act(async () => { await button(renderer, "Run").props.onClick(); });
    expect(renderer.root.findByProps({ "data-gh-action-uncertain": true })).toBeDefined();
    expect(button(renderer, "Retry")).toBeUndefined();
    expect(renderer.root.findAllByType("a").some((node) => node.props.href === "https://github.com/o/r/issues/7")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("the composer preserves the draft and refreshes without resending a torn review", async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":', { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const onMutated = vi.fn();
    const item = { repo: "o/r", number: 7, title: "Example", body: "", isPull: true, state: "open", merged: false, author: "octocat", assignees: [], labels: [], pull: null };
    const renderer = await mount(<GitHubCardComposer item={item} checks={null} threads={[]} onMutated={onMutated} />);
    await act(async () => { renderer.root.findByProps({ "aria-label": "Reply to o/r#7" }).props.onClick(); });
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: "Keep this review" } }); });
    await act(async () => { button(renderer, "Approve").props.onClick(); });
    const send = renderer.root.findByProps({ "aria-label": "Approve on o/r#7" });
    await act(async () => { await send.props.onClick(); });
    expect(button(renderer, "Send as comment instead")).toBeUndefined();
    expect(button(renderer, "Refresh to check")).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => { button(renderer, "Refresh to check").props.onClick(); });
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType("textarea").props.value).toBe("Keep this review");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// #5930: GitHub refuses APPROVE and REQUEST_CHANGES from a PR's author. A
// proposal card on your own PR must never offer or send either verdict.
describe("verdict proposals on your own pull request", () => {
  beforeEach(() => clearViewerAuthorAnswers());
  const approve = { kind: "review", repo: "o/r", number: 7, event: "APPROVE", body: "Ship it." } as const;
  const requestChanges = { kind: "review", repo: "o/r", number: 7, event: "REQUEST_CHANGES", body: "Fix the test." } as const;

  /** The item route says who wrote the PR; every write is recorded. */
  function github(viewerIsAuthor: boolean | null | "fails") {
    const writes: { url: string; payload: Record<string, unknown> }[] = [];
    const lookups: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/github/item?")) {
        lookups.push(String(url));
        if (viewerIsAuthor === "fails") return new Response("down", { status: 502 });
        return Response.json({ ok: true, isPull: true, pull: { viewerIsAuthor } });
      }
      writes.push({ url: String(url), payload: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({ ok: true });
    }));
    return { writes, lookups };
  }

  it.each([approve, requestChanges])("offers no runnable verdict, only the text as a comment: $event", async (proposal) => {
    const { writes, lookups } = github(true);
    const renderer = await mount(<GitHubActionCard action={proposal} />);
    expect(lookups).toEqual(["/api/github/item?repo=o%2Fr&number=7&pull=1"]);
    expect(button(renderer, "Run")).toBeUndefined();
    expect(renderer.root.findByProps({ "data-gh-action-own-pr": true }).children.join("")).toMatch(/You wrote this pull request/);
    const instead = button(renderer, "Comment instead");
    expect(instead.props.disabled).toBe(false);
    await act(async () => { await instead.props.onClick(); });
    expect(writes).toEqual([{ url: "/api/github/review", payload: { repo: "o/r", number: 7, event: "COMMENT", body: proposal.body } }]);
    expect(writes.some((write) => write.payload.event !== "COMMENT")).toBe(false);
  });

  it("a verdict with no text has nothing it can run on your own PR", async () => {
    const { writes } = github(true);
    const renderer = await mount(<GitHubActionCard action={{ ...approve, body: "" }} />);
    const instead = button(renderer, "Comment instead");
    expect(instead.props.disabled).toBe(true);
    expect(renderer.root.findByProps({ "data-gh-action-own-pr": true }).children.join("")).toMatch(/no text to send as a comment/);
    await act(async () => { await instead.props.onClick(); });
    expect(writes).toEqual([]);
  });

  it("holds the verdict until authorship is known, never firing it early", async () => {
    let answer: (value: Response) => void = () => {};
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).startsWith("/api/github/item?")) return new Promise<Response>((resolve) => { answer = resolve; });
      writes.push(url);
      return Promise.resolve(Response.json({ ok: true }));
    }));
    const renderer = await mount(<GitHubActionCard action={approve} />);
    const checking = button(renderer, "Checking…");
    expect(checking.props.disabled).toBe(true);
    await act(async () => { await checking.props.onClick(); });
    expect(writes).toEqual([]);
    await act(async () => { answer(Response.json({ ok: true, pull: { viewerIsAuthor: true } })); });
    expect(button(renderer, "Comment instead")).toBeDefined();
    expect(button(renderer, "Run")).toBeUndefined();
  });

  it("someone else's PR keeps the verdict", async () => {
    const { writes } = github(false);
    const renderer = await mount(<GitHubActionCard action={approve} />);
    expect(renderer.root.findAllByProps({ "data-gh-action-own-pr": true })).toHaveLength(0);
    await act(async () => { await button(renderer, "Run").props.onClick(); });
    expect(writes[0].payload.event).toBe("APPROVE");
  });

  it.each([null, "fails"] as const)("an unknown author (%s) keeps the verdict, as on every surface", async (viewer) => {
    const { writes } = github(viewer);
    const renderer = await mount(<GitHubActionCard action={requestChanges} />);
    await act(async () => { await button(renderer, "Run").props.onClick(); });
    expect(writes[0].payload.event).toBe("REQUEST_CHANGES");
  });

  it("a comment proposal on your own PR stays runnable and needs no lookup", async () => {
    const { writes, lookups } = github(true);
    const ownComment = { kind: "review", repo: "o/r", number: 7, event: "COMMENT", body: "Note for later." } as const;
    const renderer = await mount(<GitHubActionCard action={ownComment} />);
    expect(lookups).toEqual([]);
    await act(async () => { await button(renderer, "Run").props.onClick(); });
    expect(writes[0].payload.event).toBe("COMMENT");
    const plain = await mount(<GitHubActionCard action={comment} />);
    await act(async () => { await button(plain, "Run").props.onClick(); });
    expect(writes[1].url).toBe("/api/github/comment");
    expect(lookups).toEqual([]);
  });

  it("a reused card checks again for a new proposal instead of running it on the old answer", async () => {
    const answers = new Map<string, boolean>([["number=12", false], ["number=13", true]]);
    const pending: Array<() => void> = [];
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/github/item?")) {
        const value = [...answers].find(([needle]) => String(url).includes(needle))?.[1] ?? null;
        return new Promise<Response>((resolve) => pending.push(() => resolve(Response.json({ ok: true, pull: { viewerIsAuthor: value } }))));
      }
      writes.push(JSON.parse(String(init?.body ?? "{}")));
      return Promise.resolve(Response.json({ ok: true }));
    }));
    const theirs = { kind: "review", repo: "o/r", number: 12, event: "APPROVE", body: "Ship it." } as const;
    const mine = { ...theirs, number: 13 } as const;
    const renderer = await mount(<GitHubActionCard action={theirs} />);
    await act(async () => { pending.shift()!(); });
    expect(button(renderer, "Run").props.disabled).toBe(false);
    // Same slot, same component instance, now a verdict on your own PR.
    await act(async () => { renderer.update(<GitHubActionCard action={mine} />); });
    expect(button(renderer, "Run")).toBeUndefined();
    const checking = button(renderer, "Checking…");
    expect(checking.props.disabled).toBe(true);
    await act(async () => { await checking.props.onClick(); });
    await act(async () => { pending.shift()!(); });
    expect(button(renderer, "Comment instead")).toBeDefined();
    expect(writes).toEqual([]);
  });

  it("cards on one PR share a lookup, and a slow lookup reads as unknown", async () => {
    const lookups: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      lookups.push(String(url));
      return Response.json({ ok: true, pull: { viewerIsAuthor: true } });
    }));
    await mount(<GitHubActionCard action={approve} />);
    await mount(<GitHubActionCard action={requestChanges} />);
    expect(lookups).toHaveLength(1);

    clearViewerAuthorAnswers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    })));
    // The deadline the card asks for, fired by hand.
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      const renderer = await mount(<GitHubActionCard action={approve} />);
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(button(renderer, "Checking…")).toBeDefined();
      await act(async () => { deadline.abort(new DOMException("timed out", "TimeoutError")); });
      expect(button(renderer, "Run").props.disabled).toBe(false);
    } finally {
      timeout.mockRestore();
    }
  });
});
