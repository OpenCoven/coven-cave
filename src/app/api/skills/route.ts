import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

type Skill = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
};

export async function GET() {
  const res = await callDaemon<Skill[]>({ path: "/api/v1/skills" });
  if (!res.ok || !res.data) {
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, skills: [] },
    );
  }
  return NextResponse.json({ ok: true, skills: res.data });
}
