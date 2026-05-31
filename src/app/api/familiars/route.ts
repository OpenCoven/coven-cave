import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { bindingFor, loadConfig } from "@/lib/cave-config";

export const dynamic = "force-dynamic";

type DaemonFamiliar = {
  id: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
};

export async function GET() {
  const [res, config] = await Promise.all([
    callDaemon<(DaemonFamiliar & { emoji?: string })[]>({ path: "/api/v1/familiars" }),
    loadConfig(),
  ]);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, familiars: [] },
      { status: 503 },
    );
  }
  // Pass `emoji` through — it's the daemon-provided default glyph the
  // glyph picker uses as the starting value. The Cave-local override store
  // (`cave-glyph-overrides.ts`) wins on render when the user picks something.
  const familiars = (res.data ?? []).map((f) => {
    const binding = bindingFor(config, f.id);
    return { ...f, harness: binding.harness, model: binding.model, note: binding.note };
  });
  return NextResponse.json({ ok: true, familiars });
}
