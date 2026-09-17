import type { Citation } from "./covenwiki-generate.ts";
import type { WikiManifest } from "./covenwiki-regen.ts";

export type CovenWikiManifest = WikiManifest & {
  summary?: string;
  generation: WikiManifest["generation"] & { wordTarget?: number[] | null };
};

export type CovenWikiPage = {
  markdown: string;
  meta: { slug?: string; title?: string; citations: Citation[]; coverageNotes: string[]; relatedPages: string[] };
};

export function isCovenWikiSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function isCovenWikiRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && !/[\\\x00-\x1f\x7f:%?#]/.test(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function covenWikiHref(repo: string, slug?: string): string {
  return `/wikis/${encodeURIComponent(repo)}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
}

/** Generated relative page links stay within this wiki; source links use the citations panel. */
export function covenWikiMarkdownHref(manifest: CovenWikiManifest, href: string): string | null {
  if (/^(https?:\/\/|mailto:|#)/i.test(href)) return href;
  const [pathname, hash] = href.split("#", 2);
  const relative = pathname.replace(/^\.\//, "");
  if (relative === "index.md") return covenWikiHref(manifest.slug) + (hash ? `#${hash}` : "");
  const page = manifest.pages.find((entry) => relative === entry.path || relative === `${entry.slug}.md` || relative === entry.slug);
  return page ? covenWikiHref(manifest.slug, page.slug) + (hash ? `#${hash}` : "") : null;
}
