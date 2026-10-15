import { researchCapability } from '@/lib/research-capability';
import { rejectNonLocalRequest } from '@/lib/server/api-security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function GET(req: Request): Response {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  return Response.json({ ok: true, ...researchCapability() });
}
