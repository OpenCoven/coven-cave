import "@/styles/covenwiki.css";
import Link from "next/link";
import { createCovenWikiStore } from "@/lib/covenwiki-store";
import { covenWikiHref } from "@/lib/covenwiki-render";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function WikisPage() {
  const wikis = await createCovenWikiStore().list();
  return <main className="covenwiki-index">
    <Link href="/" className="focus-ring">Back to Cave</Link>
    <h1>Wikis</h1>
    <p className="covenwiki-muted">Source-grounded guides for your local projects.</p>
    {wikis.length === 0 ? <EmptyState headline="No wikis yet" subtitle={<>Generate a wiki for a local project, then reload this page.<pre>node --experimental-strip-types scripts/covenwiki-generate.ts generate --repo /path/to/project --backend stub</pre></>} />
      : <ul className="covenwiki-list">{wikis.map((wiki) => <li key={wiki.slug}>
        <Link className="focus-ring" href={covenWikiHref(wiki.slug)} prefetch={false}>{wiki.title}</Link>
        {wiki.summary && <p>{wiki.summary}</p>}
        <p className="covenwiki-muted">{wiki.pages.length} pages{wiki.generation.status === "stub" ? " · Draft" : wiki.generation.status === "partial" ? " · Partially generated" : ""}</p>
      </li>)}</ul>}
  </main>;
}
