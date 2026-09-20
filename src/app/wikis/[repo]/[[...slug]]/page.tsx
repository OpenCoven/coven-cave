import { notFound } from "next/navigation";
import { createCovenWikiStore } from "@/lib/covenwiki-store";
import { isCovenWikiSlug } from "@/lib/covenwiki-render";
import { CovenWikiReader } from "@/components/covenwiki-reader";

export const dynamic = "force-dynamic";

export default async function WikiPage({ params }: { params: Promise<{ repo: string; slug?: string[] }> }) {
  const { repo, slug = [] } = await params;
  if (!isCovenWikiSlug(repo) || slug.length > 1 || slug.some((part) => !isCovenWikiSlug(part))) notFound();
  const manifest = await createCovenWikiStore().manifest(repo);
  if (!manifest || (slug.length > 0 && !manifest.pages.some((page) => page.slug === slug[0]))) notFound();
  // Server shell reads only the manifest. The reader fetches the selected page lazily.
  return <CovenWikiReader key={`${repo}/${slug[0] ?? ""}`} manifest={manifest} slug={slug[0]} />;
}
