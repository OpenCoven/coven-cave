/**
 * /api/prompts
 *
 * GET — prompt templates for the chat composer's /prompt picker and the
 * Prompt snippets modal. Merges three sources by id (user > pack > builtin):
 *  1. built-in defaults (src/lib/prompt-defaults.ts)
 *  2. installed marketplace prompt packs (marketplace/plugins/<id>/prompts/) —
 *     install is track-only (cave-config marketplace.installed), so packs are
 *     resolved here at scan time rather than copied on install
 *  3. the user's own ~/.coven/prompts/*.md files
 *
 * POST — save a user template to ~/.coven/prompts/<slug>.md (cave-jg6k:
 * save-as-template / edit from the app). DELETE ?id=<slug> removes one.
 * Both are desktop-only (isLocalOrigin) and id-confined: the slug regex is
 * the only path component ever accepted — callers can't reach outside the
 * prompts dir. Pack and builtin templates are never writable here (users
 * override them by saving under the same id instead — merge order wins).
 */

import { NextResponse } from "next/server";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { loadConfig } from "@/lib/cave-config";
import { BUILTIN_PROMPTS } from "@/lib/prompt-defaults";
import { writeFileAtomic } from "@/lib/server/atomic-write";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { PROMPT_SLUG_RE, promptSlug, serializePromptTemplate } from "@/lib/server/prompt-file";
import { mergePrompts, scanPromptsDir } from "@/lib/server/prompt-scan";
import type { PromptOption } from "@/lib/slash-prompt";

export const dynamic = "force-dynamic";

const MARKETPLACE_PLUGINS_DIR = path.join(process.cwd(), "marketplace", "plugins");

export async function GET() {
  const user: PromptOption[] = [];
  await scanPromptsDir(path.join(covenHome(), "prompts"), "user", user);

  const packs: PromptOption[] = [];
  try {
    const cfg = await loadConfig();
    // Installed ids were validated against the catalog allowlist on install;
    // the shape guard keeps a hand-edited config from escaping the plugins dir.
    const installed = Object.keys(cfg.marketplace.installed).filter((id) => /^[\w.-]+$/.test(id));
    await Promise.all(
      installed.map((id) =>
        scanPromptsDir(path.join(MARKETPLACE_PLUGINS_DIR, id, "prompts"), `pack:${id}`, packs),
      ),
    );
  } catch {
    // Config unreadable → built-ins + user files still serve.
  }

  return NextResponse.json({ ok: true, prompts: mergePrompts(BUILTIN_PROMPTS, user, packs) });
}

function userPromptsDir(): string {
  return path.join(covenHome(), "prompts");
}

type SavePromptBody = {
  name?: unknown;
  body?: unknown;
  description?: unknown;
  icon?: unknown;
  tags?: unknown;
  id?: unknown;
  overwrite?: unknown;
};

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "desktop only" }, { status: 403 });
  }
  let raw: SavePromptBody;
  try {
    raw = (await req.json()) as SavePromptBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  if (!body) return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });

  // Explicit id (edit/duplicate flows) must already be a valid slug; without
  // one the display name derives it.
  const id =
    typeof raw.id === "string" && raw.id
      ? PROMPT_SLUG_RE.test(raw.id)
        ? raw.id
        : null
      : promptSlug(name);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id must be a lowercase alphanumeric-dash slug" },
      { status: 400 },
    );
  }

  const dir = userPromptsDir();
  // path.basename is the CodeQL-recognized js/path-injection sanitizer; the
  // slug regex above already forbids any separator, so this is a no-op on
  // valid input and defense-in-depth against a future looser id source.
  const file = path.join(dir, `${path.basename(id)}.md`);
  if (raw.overwrite !== true) {
    try {
      await stat(file);
      return NextResponse.json(
        { ok: false, error: `a template named "${id}" already exists`, id },
        { status: 409 },
      );
    } catch {
      // Absent — clear to create.
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFileAtomic(
    file,
    serializePromptTemplate({
      name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      icon: typeof raw.icon === "string" ? raw.icon : undefined,
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((t): t is string => typeof t === "string")
        : undefined,
      body,
    }),
  );

  // Return the template as the scanner sees it, so callers render exactly
  // what the next GET will serve (round-trip guarantee).
  const scanned: PromptOption[] = [];
  await scanPromptsDir(dir, "user", scanned);
  const prompt = scanned.find((p) => p.id === id);
  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "template was written but did not scan back" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, prompt });
}

export async function DELETE(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "desktop only" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  // The slug regex is the confinement: no separators, dots, or traversal can
  // pass it, so the join below cannot escape the prompts dir.
  if (!PROMPT_SLUG_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid template id" }, { status: 400 });
  }
  try {
    // path.basename is the recognized path-injection sanitizer (see POST).
    await unlink(path.join(userPromptsDir(), `${path.basename(id)}.md`));
  } catch {
    return NextResponse.json({ ok: false, error: "template not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
