import { redirect } from "next/navigation";

// /familiars/[id]/analytics duplicated /dashboard/familiars/[id]/analytics
// byte-for-byte (issue #3283, cave-m4ih.5). The dashboard tree is canonical —
// every internal link already points there — so this stub finishes the
// redirect pattern /familiars/growth and /retro started. Query strings are
// forwarded and browsers carry #fragments across redirects, so deep links
// keep working.
export default async function FamiliarAnalyticsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) for (const item of value) qs.append(key, item);
    else if (value !== undefined) qs.append(key, value);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  redirect(`/dashboard/familiars/${encodeURIComponent(id)}/analytics${suffix}`);
}
