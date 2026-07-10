/**
 * Sewing — the headless distillation of a stitch thread into a vault entry.
 *
 * Follows the automation-runner stance: the `codex exec` invocation is built
 * by a pure, unit-tested function; the spawn itself is verified manually (CI
 * has no codex binary). The prompt goes to stdin; the agent's final message is
 * read from `--output-last-message` (a temp file), keeping progress noise on
 * stdout/stderr out of the parse.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildManualStitchBody, buildSewPrompt, parseSewOutput, pinRefs, type SewOutput, type StitchThread } from "../stitch.ts";
import {
  isValidKnowledgeId,
  readKnowledgeEntry,
  slugifyKnowledgeId,
  writeKnowledgeEntry,
  type KnowledgeEntry,
} from "./knowledge-vault.ts";

export type SewInvocation = {
  command: string;
  args: string[];
  stdinPrompt: string;
};

const SEW_TIMEOUT_MS = 180_000;

/** Pure: how to invoke `codex exec` for a sew. Unit-tested.
 *
 *  Unlike automation runs (user-authored prompts), the sew prompt embeds
 *  attacker-influenceable remote content (fetched pages, GitHub bodies), so
 *  the invocation pins its own privileges instead of inheriting the user's
 *  codex config: a distillation needs no tools, so `--sandbox read-only`
 *  overrides any permissive default while the run distills. */
export function buildSewInvocation(thread: Pick<StitchThread, "title" | "pins">, lastMessagePath: string): SewInvocation {
  const command = process.env.COVEN_CODEX_BIN?.trim() || "codex";
  return {
    command,
    args: ["exec", "--sandbox", "read-only", "--output-last-message", lastMessagePath, "-"],
    stdinPrompt: buildSewPrompt(thread),
  };
}

/** Pick a free vault id for a sewn title: slug, then slug-2, slug-3… Unit-tested. */
export async function uniqueStitchId(title: string): Promise<string | null> {
  const base = slugifyKnowledgeId(title) || "stitch";
  if (!isValidKnowledgeId(base)) return null;
  if (!(await readKnowledgeEntry(base))) return base;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!isValidKnowledgeId(candidate)) return null;
    if (!(await readKnowledgeEntry(candidate))) return candidate;
  }
  return null;
}

export type SewRunResult =
  | { ok: true; entry: KnowledgeEntry }
  | { ok: false; error: string };

/** Persist a parsed sew output as a vault entry with pin provenance. */
export async function writeSewnEntry(thread: StitchThread, output: SewOutput): Promise<SewRunResult> {
  const id = await uniqueStitchId(output.title);
  if (!id) return { ok: false, error: "could not derive a vault id from the sewn title" };
  const entry = await writeKnowledgeEntry({
    id,
    title: output.title,
    tags: output.tags,
    scope: "global",
    enabled: true,
    body: output.body,
    pins: pinRefs(thread.pins),
  });
  return { ok: true, entry };
}

/**
 * The manual sew: no model in the loop — pins concatenated under headings into
 * an entry the user immediately edits. Same provenance as the agentic path.
 */
export async function runManualSew(thread: StitchThread): Promise<SewRunResult> {
  if (thread.pins.length === 0) return { ok: false, error: "thread has no pins" };
  return writeSewnEntry(thread, {
    title: thread.title.trim() || `Stitch ${new Date().toISOString().slice(0, 10)}`,
    tags: [],
    body: buildManualStitchBody(thread),
  });
}

/**
 * Run the agentic sew end-to-end: spawn `codex exec`, wait (bounded), parse
 * the final message, write the vault entry. Never throws. Spawn behavior is
 * exercised manually — CI covers `buildSewInvocation`/`writeSewnEntry` only.
 */
export async function runAgenticSew(thread: StitchThread): Promise<SewRunResult> {
  if (thread.pins.length === 0) return { ok: false, error: "thread has no pins" };
  const dir = await mkdtemp(path.join(tmpdir(), "stitch-sew-"));
  const lastMessagePath = path.join(dir, "last-message.txt");
  try {
    const inv = buildSewInvocation(thread, lastMessagePath);
    const spawned = await new Promise<{ code: number | null; error?: string }>((resolve) => {
      let settled = false;
      const settle = (value: { code: number | null; error?: string }) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      // Neutral cwd: the sew's temp dir, not the server checkout — even a
      // read-only sandbox shouldn't be pointed at the repo as its workspace.
      const child = spawn(inv.command, inv.args, { cwd: dir, stdio: ["pipe", "ignore", "ignore"] });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle({ code: null, error: "sew timed out" });
      }, SEW_TIMEOUT_MS);
      child.on("error", (err) => {
        clearTimeout(timer);
        settle({ code: null, error: err.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        settle({ code });
      });
      child.stdin.write(inv.stdinPrompt);
      child.stdin.end();
    });
    if (spawned.error) return { ok: false, error: spawned.error };
    if (spawned.code !== 0) return { ok: false, error: `codex exec exited with ${spawned.code}` };
    let lastMessage: string;
    try {
      lastMessage = await readFile(lastMessagePath, "utf8");
    } catch {
      return { ok: false, error: "sew produced no output" };
    }
    const output = parseSewOutput(lastMessage);
    if (!output) return { ok: false, error: "sew output did not match the stitch format — try again" };
    return await writeSewnEntry(thread, output);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "sew failed" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
