// The agent-proposal card never offers a blind Retry for a GitHub write that
// may already have landed (#6369).
import { afterEach, describe, expect, it, vi } from "vitest";

import { fireGitHubAction, githubActionTargetUrl } from "./github-action-card";

const comment = { kind: "comment", repo: "o/r", number: 7, body: "Looks good." } as const;

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
