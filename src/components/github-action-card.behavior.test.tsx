// @ts-nocheck
// The agent-proposal card never offers a blind Retry for a GitHub write that
// may already have landed (#6369).
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubCardComposer } from "./github-card-composer";

import { GitHubActionCard, fireGitHubAction, githubActionTargetUrl } from "./github-action-card";

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
