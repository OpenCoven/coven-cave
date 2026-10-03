/**
 * Links in a rendered README or pull request description (#5781).
 *
 * The desk rendered Markdown without a link handler, so a click followed the
 * anchor: `[guide](docs/guide.md)` sent the whole app to `/docs/guide.md`, and
 * an https link replaced it, taking the in-memory desk state with it. Every
 * click on a link now stays in the app: a web link opens the way the app
 * opens external links, a link to another file in the project opens it in
 * the desk, and anything else does nothing.
 */

export type MarkdownLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "file"; path: string }
  | { kind: "fragment" }
  | { kind: "none" };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where a link's `href` leads, read from the document at `filePath` (absolute)
 * inside `projectRoot`. A link that starts with `/` is from the project root,
 * as GitHub reads it. Without a file, only web links and fragments resolve.
 */
export function markdownLinkTarget(
  href: string,
  filePath: string | null = null,
  projectRoot: string | null = null,
): MarkdownLinkTarget {
  const raw = href.trim();
  if (!raw) return { kind: "none" };
  if (raw.startsWith("#")) return { kind: "fragment" };
  if (/^https?:\/\//i.test(raw)) return { kind: "external", url: raw };
  if (SCHEME_RE.test(raw) || raw.startsWith("//") || !filePath) return { kind: "none" };

  const bare = raw.split("#")[0].split("?")[0];
  if (!bare) return { kind: "none" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return { kind: "none" };
  }
  // Windows paths (#5787 review): the tree hands over native paths, with
  // backslashes and a drive, while project roots use forward slashes. Work in
  // forward slashes and give the path back the way the file's own came.
  const file = forward(filePath);
  const root = projectRoot ? trimSlashes(forward(projectRoot)) : null;
  const base = decoded.startsWith("/") && root ? root : file.slice(0, file.lastIndexOf("/"));
  const resolved = normalize(`${base}/${decoded.replace(/^\/+/, "")}`);
  if (!resolved) return { kind: "none" };
  if (root && !within(resolved, root)) return { kind: "none" };
  return { kind: "file", path: filePath.includes("\\") ? resolved.replace(/\//g, "\\") : resolved };
}

function forward(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

/** Inside `root`. Under a Windows drive, without case, as its filesystem reads. */
function within(path: string, root: string): boolean {
  const drive = /^[a-z]:\//i.test(root);
  const [p, r] = drive ? [path.toLowerCase(), root.toLowerCase()] : [path, root];
  return p === r || p.startsWith(r.endsWith("/") ? r : `${r}/`);
}

/** `/a/b/../c/./d` → `/a/c/d`, and `C:/a/../b` → `C:/b`; null when `..`
 *  climbs past the top. */
function normalize(absolute: string): string | null {
  const drive = /^[a-z]:(?=\/)/i.exec(absolute)?.[0] ?? "";
  const out: string[] = [];
  for (const part of absolute.slice(drive.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return `${drive}/${out.join("/")}`;
}

/**
 * A click handler for the element around rendered Markdown, run in the
 * capture phase so it decides before the anchor's own navigation. A plain
 * click on any link is kept in the app; fragments still scroll in place.
 */
export function handleMarkdownLinkClick(
  event: { target: EventTarget | null; defaultPrevented: boolean; preventDefault: () => void },
  options: {
    filePath?: string | null;
    projectRoot?: string | null;
    openExternal: (url: string) => void;
    openFile?: (path: string) => void;
  },
): void {
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || event.defaultPrevented) return;
  const target = markdownLinkTarget(anchor.getAttribute("href") ?? "", options.filePath ?? null, options.projectRoot ?? null);
  if (target.kind === "fragment") return;
  event.preventDefault();
  if (target.kind === "external") options.openExternal(target.url);
  else if (target.kind === "file") options.openFile?.(target.path);
}
