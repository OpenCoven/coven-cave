"use client";

import "@/styles/covenwiki.css";
import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MarkdownBlock } from "./message-bubble";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { SkeletonRows } from "./ui/skeleton";
import { covenWikiHref, covenWikiMarkdownHref, type CovenWikiManifest, type CovenWikiPage } from "@/lib/covenwiki-render";
import type { WikiNavNode } from "@/lib/covenwiki-regen";
import type { Citation } from "@/lib/covenwiki-generate";

const FilePreview = dynamic(() => import("./rail-file-preview").then((module) => module.RailFilePreview), {
  loading: () => <p role="status">Opening source file…</p>,
});

function WikiNavigation({ nodes, repo, active }: { nodes: WikiNavNode[]; repo: string; active?: string }) {
  return <ul className="covenwiki-nav">
    {nodes.map((node, index) => <li key={`${node.slug ?? node.title}-${index}`}>
      {node.slug === null
        ? <span className="covenwiki-group">{node.title}</span>
        : <Link className="focus-ring" href={covenWikiHref(repo, node.slug)} prefetch={false} aria-current={active === node.slug ? "page" : undefined}>{node.title}</Link>}
      {node.children.length > 0 && <WikiNavigation nodes={node.children} repo={repo} active={active} />}
    </li>)}
  </ul>;
}

export function CovenWikiReader({ manifest, slug }: { manifest: CovenWikiManifest; slug?: string }) {
  const [loaded, setLoaded] = useState<{ key: string; page: CovenWikiPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [citation, setCitation] = useState<Citation | null>(null);
  const key = `${manifest.slug}/${slug ?? ""}`;
  const page = loaded?.key === key ? loaded.page : null;
  const error = failure?.key === key ? failure.message : null;
  const entry = manifest.pages.find((candidate) => candidate.slug === slug);

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/wikis/${encodeURIComponent(manifest.slug)}/page${slug ? `/${encodeURIComponent(slug)}` : ""}`;
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This wiki page isn't available. Choose another page or retry." : "Couldn't load this page. Try again.");
        const body = await response.json();
        if (!body.ok || !body.page) throw new Error("Couldn't load this page. Try again.");
        if (!controller.signal.aborted) {
          setLoaded({ key, page: body.page });
          setFailure(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : "Couldn't load this page. Try again." });
      });
    return () => controller.abort();
  }, [manifest.slug, slug, key, attempt]);

  function followMarkdownLink(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a");
    if (!anchor) return;
    const original = anchor.dataset.wikiHref ?? anchor.getAttribute("href") ?? "";
    anchor.dataset.wikiHref = original;
    const href = covenWikiMarkdownHref(manifest, original);
    if (href === null) { event.preventDefault(); return; }
    anchor.setAttribute("href", href);
  }

  const root = manifest.source.kind === "local" ? manifest.source.repoRoot : null;
  const sourcePath = root && citation ? `${root.replace(/[\\/]$/, "")}/${citation.path}` : null;
  const belowTarget = entry?.wordCount !== undefined && manifest.generation.wordTarget?.[0] !== undefined
    && entry.wordCount < manifest.generation.wordTarget[0];
  // The manifest already supplies the visible page heading. Preserve any different heading.
  const markdown = page?.markdown.replace(/^# ([^\r\n]+)\r?\n+/, (heading, title: string) =>
    title.trim() === (entry?.title ?? manifest.title).trim() ? "" : heading);

  return <div className="covenwiki-layout">
    <aside className="covenwiki-sidebar">
      <Link href="/wikis" className="focus-ring">All wikis</Link>
      <h1>{manifest.title}</h1>
      {manifest.summary && <p className="covenwiki-muted">{manifest.summary}</p>}
      {manifest.generation.status === "stub" && <p className="covenwiki-status">Draft · Placeholder prose</p>}
      {manifest.generation.status === "partial" && <p className="covenwiki-status">Partially generated</p>}
      <nav aria-label="Wiki pages">
        <Link className="focus-ring" href={covenWikiHref(manifest.slug)} prefetch={false} aria-current={!slug ? "page" : undefined}>Wiki index</Link>
        <WikiNavigation nodes={manifest.navigation} repo={manifest.slug} active={slug} />
      </nav>
    </aside>
    <main className="covenwiki-main" id="wiki-content">
      <header className="covenwiki-page-header">
        <h2>{entry?.title ?? manifest.title}</h2>
        {entry && <p className="covenwiki-muted">{entry.priority} page{entry.wordCount !== undefined ? ` · ${entry.wordCount} words` : ""}{belowTarget ? " · Below prose target" : ""}</p>}
      </header>
      {error ? <div role="alert"><p>{error}</p><Button onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Retry</Button></div>
        : page ? <>
          <div className="covenwiki-prose" onClickCapture={followMarkdownLink} onAuxClickCapture={followMarkdownLink} onContextMenuCapture={followMarkdownLink}>
            <MarkdownBlock key={key} text={markdown ?? ""} suppressRemoteMedia />
          </div>
          {(page.meta.citations.length > 0 || page.meta.coverageNotes.length > 0 || page.meta.relatedPages.length > 0) && <section className="covenwiki-evidence" aria-label="Page sources and coverage">
            {page.meta.citations.length > 0 && <><h3>Sources</h3><ul>
              {page.meta.citations.map((source, index) => <li key={`${source.path}-${index}`}>
                {root ? <Button variant="ghost" className="focus-ring" data-citation onClick={() => setCitation(source)}>
                  {source.path}{source.startLine !== null ? ` · L${source.startLine}${source.endLine !== null && source.endLine !== source.startLine ? `–${source.endLine}` : ""}` : ""}
                </Button> : <span>{source.path} · Local source unavailable</span>}
              </li>)}
            </ul></>}
            {page.meta.coverageNotes.length > 0 && <><h3>Coverage notes</h3><ul>{page.meta.coverageNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></>}
            {page.meta.relatedPages.length > 0 && <><h3>Related pages</h3><ul>{page.meta.relatedPages.map((related) => <li key={related}>
              <Link className="focus-ring" href={covenWikiHref(manifest.slug, related)} prefetch={false}>{manifest.pages.find((candidate) => candidate.slug === related)?.title ?? related}</Link>
            </li>)}</ul></>}
          </section>}
        </> : <div role="status" aria-label="Loading wiki page"><SkeletonRows count={4} /></div>}
    </main>
    <Modal open={citation !== null} onClose={() => setCitation(null)} ariaLabel="Wiki source file" wide>
      {sourcePath && <div className="covenwiki-file"><FilePreview path={sourcePath} projectRoot={root ?? null} initialLine={citation?.startLine} rangeLabel="Wiki citation" /></div>}
    </Modal>
  </div>;
}
