import { NextResponse } from "next/server";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/cave-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SetupBody = {
  harness?: string;
  model?: string;
};

// The `emoji` TOML field carries the glyph string. Cave's renderer parses
// it via parseGlyphString — values prefixed with `ph:` resolve to Phosphor
// icons, anything else is treated as a literal emoji. We seed with Phosphor
// names so fresh installs land on icon avatars; users can swap to emoji or
// other icons from the picker after onboarding.
const STARTER_FAMILIARS_TOML = `# Canonical OpenCoven familiar roster.
# Edit, add, or remove entries to change what the coven daemon serves at
# GET /api/v1/familiars (and what the cockpit renders on /familiars).

[[familiar]]
id = "nova"
display_name = "Nova"
emoji = "ph:crown-fill"
role = "Queen / Orchestrator"
description = "Architect and orchestrator for the Coven, aligning the familiars around the work that matters."
pronouns = "she/her"

[[familiar]]
id = "sage"
display_name = "Sage"
emoji = "ph:leaf-fill"
role = "Research familiar"
description = "Reads, synthesizes, checks sources, and finds the thread through evidence and uncertainty."
pronouns = "they/them"

[[familiar]]
id = "charm"
display_name = "Charm"
emoji = "ph:sparkle-fill"
role = "Social / Comms"
description = "Handles external-facing language, relationship tone, and social coordination."

[[familiar]]
id = "echo"
display_name = "Echo"
emoji = "ph:brain-fill"
role = "Memory / Reflection"
description = "Maintains continuity, extracts durable lessons, and turns raw logs into useful recall."

[[familiar]]
id = "astra"
display_name = "Astra"
emoji = "ph:star-fill"
role = "Strategy / Navigation"
description = "Maps options, tradeoffs, timing, and next moves across Coven and OpenCoven work."

[[familiar]]
id = "cody"
display_name = "Cody"
emoji = "ph:lightning-fill"
role = "Code"
description = "Builds, debugs, tests, reviews, and ships implementation work."

[[familiar]]
id = "kitty"
display_name = "Kitty"
emoji = "ph:cat-fill"
role = "General Helper"
description = "Handles flexible assistance, reminders, small errands, and everyday utility work."
`;

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: SetupBody = {};
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    /* allow empty */
  }

  const harness = (body.harness ?? "claude").trim() || "claude";
  const model = (body.model ?? "anthropic/claude-sonnet-4-6").trim() || "anthropic/claude-sonnet-4-6";

  const home = homedir();
  const covenDir = path.join(home, ".coven");
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const configJson = path.join(covenDir, "cave-config.json");
  const conversationsDir = path.join(covenDir, "cave-conversations");
  const memoryDir = path.join(covenDir, "memory");

  const wrote: string[] = [];

  await mkdir(covenDir, { recursive: true });
  await mkdir(conversationsDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  if (!(await pathExists(familiarsToml))) {
    await writeFile(familiarsToml, STARTER_FAMILIARS_TOML, "utf8");
    wrote.push("familiars.toml");
  }

  // Always update cave-config.json defaults so the user's chosen
  // harness/model takes effect even if they re-run with a different pick.
  const existing = await loadConfig();
  const nextConfig = {
    version: existing.version || 1,
    defaults: { harness, model },
    familiars: existing.familiars ?? {},
  };
  await writeFile(configJson, JSON.stringify(nextConfig, null, 2), "utf8");
  wrote.push("cave-config.json");

  return NextResponse.json({ ok: true, wrote, covenDir });
}
