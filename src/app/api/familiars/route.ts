import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";

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
    callDaemon<(DaemonFamiliar & { emoji?: string; icon?: string })[]>({
      path: "/api/v1/familiars",
    }),
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
  //
  // `avatarUrl` points at the workspace avatar (.../familiars/<id>/avatars/<img>)
  // when one exists, cache-busted by file mtime plus renderer format so both
  // content changes and server-side encoding changes refetch in desktop
  // WebViews. Familiars with no on-disk avatar omit it and render the glyph.
  const familiars = await Promise.all(
    (res.data ?? []).map(async (f) => {
      const binding = bindingFor(config, f.id);
      const avatar = await resolveFamiliarAvatar(f.id);
      return {
        ...f,
        display_name: binding.display_name ?? f.display_name,
        role: binding.role ?? f.role,
        pronouns: binding.pronouns ?? f.pronouns,
        description: binding.description ?? f.description,
        color: binding.color,
        harness: binding.harness,
        model: binding.model,
        note: binding.note,
        voiceProvider: binding.voiceProvider,
        voiceModel: binding.voiceModel,
        voiceName: binding.voiceName,
        avatarUrl: avatar
          ? `/api/familiars/${encodeURIComponent(f.id)}/avatar?v=${Math.round(avatar.mtimeMs)}&format=png`
          : undefined,
      };
    }),
  );
  return NextResponse.json({ ok: true, familiars });
}
