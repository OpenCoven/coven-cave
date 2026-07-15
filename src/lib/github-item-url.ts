// Parse github.com PR/issue URLs into a native-surface deep-link target.
// Pure and framework-free: the workspace uses it to route GitHub-event inbox
// notifications (github-watcher writes `link: { kind: "url", ref: html_url }`)
// into the native GitHub surface instead of a browser tab; the GitHub view
// uses the parsed repo/number to fetch the item detail directly.

export type GitHubItemTarget = {
  /** "owner/name" */
  repo: string;
  number: number;
  kind: "pr" | "issue";
  /** The original URL, kept for "open on GitHub" affordances. */
  url: string;
};

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Returns a target for `https://github.com/<owner>/<repo>/pull/<n>` and
 * `/issues/<n>` URLs (trailing paths, query strings, and fragments — e.g.
 * `/files`, `#issuecomment-…` — are tolerated). Anything else (actions runs,
 * repo roots, non-GitHub hosts) returns null so callers fall back to the
 * in-app browser pane.
 */
export function parseGitHubItemUrl(raw: string | null | undefined): GitHubItemTarget | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, name, section, num] = segments;
  if (!owner || !name || !section || !num) return null;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
  if (section !== "pull" && section !== "issues") return null;
  const number = Number.parseInt(num, 10);
  if (!Number.isInteger(number) || number <= 0 || String(number) !== num) return null;

  return {
    repo: `${owner}/${name}`,
    number,
    kind: section === "pull" ? "pr" : "issue",
    url: url.toString(),
  };
}
