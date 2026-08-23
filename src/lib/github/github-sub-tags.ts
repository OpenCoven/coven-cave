// Pure helpers around github-watcher's inbox `auto` tags. Client-safe (the
// full subscriptions store lives in github-subscriptions.ts, which is
// server-only — node:fs), so feed rows can offer "Unwatch owner/repo" without
// dragging fs into the bundle.
//
// Tag shapes the watcher writes (see github-watcher.ts):
//   github-sub:pr-opened:<owner/repo>#<number>
//   github-sub:ci:<owner/repo>:<runId>

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** True when an inbox item's `auto` tag marks a GitHub-subscription event. */
export function isGithubSubTag(auto: string | null | undefined): boolean {
  return typeof auto === "string" && auto.startsWith("github-sub:");
}

/** The watched `owner/repo` a github-sub tag refers to, or null. */
export function repoFromGithubSubTag(auto: string | null | undefined): string | null {
  if (!isGithubSubTag(auto)) return null;
  const rest = (auto as string).slice("github-sub:".length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  let target = rest.slice(sep + 1);
  const hash = target.indexOf("#");
  if (hash !== -1) {
    // pr-opened:<repo>#<number>
    target = target.slice(0, hash);
  } else {
    // ci:<repo>:<runId>
    const lastColon = target.lastIndexOf(":");
    if (lastColon !== -1) target = target.slice(0, lastColon);
  }
  return REPO_RE.test(target) ? target : null;
}
