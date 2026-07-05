#!/usr/bin/env node --experimental-strip-types
// Coven → Hermes Flight Recorder (HFR) trace exporter CLI.
//
// Reads Coven Cave conversation files (the per-familiar record of tool calls,
// LLM usage, and answers) and emits HFR observer-hook JSONL to stdout or a
// file. HFR then normalizes and scores the trace against scenario contracts.
//
// The transform lives in src/lib/hfr-trace-export.ts (pure, unit-tested); this
// file is just the I/O shell — locate files, parse JSON defensively, write out.
//
// Usage:
//   pnpm hfr:export --session <id>          # selected conversation → stdout
//   pnpm hfr:export --familiar cody         # cody's run, if it selects one
//   pnpm hfr:export --session <id> --out trace.jsonl
//   pnpm hfr:export --subagents links.json  # splice in delegation edges
//
// Options:
//   --dir <path>            conversations dir (default $COVEN_HOME/cave-conversations)
//   --session <id>          export a single conversation by id
//   --familiar <id>         only conversations for this familiar
//   --subagents <path>      JSON array of {parentSessionId, childSessionId, ...}
//   --out <path>            write JSONL here (default stdout)
//   --source-format <str>   override the session event's source_format
//   --max-field-chars <n>   cap free-text fields (0 disables)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  conversationToHfrEvents,
  serializeHfrJsonl,
  type HfrConversationInput,
  type HfrObserverEvent,
  type HfrSubagentLink,
} from "../src/lib/hfr-trace-export.ts";

type Options = {
  dir: string;
  session: string | null;
  familiar: string | null;
  subagents: string | null;
  out: string | null;
  sourceFormat: string | null;
  maxFieldChars: number | null;
};

function defaultConversationsDir(): string {
  const home = process.env.COVEN_HOME ?? path.join(homedir(), ".coven");
  return path.join(home, "cave-conversations");
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dir: defaultConversationsDir(),
    session: null,
    familiar: null,
    subagents: null,
    out: null,
    sourceFormat: null,
    maxFieldChars: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        opts.dir = argv[++i] ?? opts.dir;
        break;
      case "--session":
        opts.session = argv[++i] ?? null;
        break;
      case "--familiar":
        opts.familiar = argv[++i] ?? null;
        break;
      case "--subagents":
        opts.subagents = argv[++i] ?? null;
        break;
      case "--out":
        opts.out = argv[++i] ?? null;
        break;
      case "--source-format":
        opts.sourceFormat = argv[++i] ?? null;
        break;
      case "--max-field-chars": {
        const n = Number(argv[++i] ?? "");
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("--max-field-chars requires a non-negative number");
        }
        opts.maxFieldChars = n;
        break;
      }
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const HELP = `coven-hfr-export — export Coven familiar runs as HFR observer-hook JSONL

  --dir <path>            conversations dir (default $COVEN_HOME/cave-conversations)
  --session <id>          export a single conversation by id
  --familiar <id>         only conversations for this familiar; must select one
  --subagents <path>      JSON array of {parentSessionId, childSessionId, ...}
  --out <path>            write JSONL here (default stdout)
  --source-format <str>   override the session event's source_format
  --max-field-chars <n>   cap free-text fields (0 disables)
  -h, --help              show this help
`;

/** Parse a conversation file, returning null (with a stderr warning) on any
 *  read/parse error so one bad file never aborts the whole export. */
function readConversation(file: string): HfrConversationInput | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    process.stderr.write(`warn: cannot read ${file}: ${(err as Error).message}\n`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(`warn: skipping non-JSON ${file}\n`);
    return null;
  }
  const conv = parsed as Partial<HfrConversationInput>;
  if (!conv || typeof conv.sessionId !== "string" || !Array.isArray(conv.turns)) {
    process.stderr.write(`warn: skipping ${file}: not a conversation file\n`);
    return null;
  }
  return conv as HfrConversationInput;
}

function readSubagentLinks(file: string): HfrSubagentLink[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { calls?: unknown }).calls)
      ? (parsed as { calls: unknown[] }).calls
      : [];
  return (list as Array<Record<string, unknown>>)
    .filter((l) => typeof l.parentSessionId === "string" && typeof l.childSessionId === "string")
    .map((l) => l as unknown as HfrSubagentLink);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  let files: string[];
  try {
    files = readdirSync(opts.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(opts.dir, f))
      .sort();
  } catch (err) {
    process.stderr.write(`error: cannot list ${opts.dir}: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }

  const subagentLinks = opts.subagents ? readSubagentLinks(opts.subagents) : [];

  const matches: Array<{ conv: HfrConversationInput; events: HfrObserverEvent[] }> = [];
  for (const file of files) {
    const conv = readConversation(file);
    if (!conv) continue;
    if (opts.session && conv.sessionId !== opts.session) continue;
    if (opts.familiar && conv.familiarId !== opts.familiar) continue;
    matches.push({
      conv,
      events: conversationToHfrEvents(conv, {
        subagentLinks,
        sourceFormat: opts.sourceFormat ?? undefined,
        maxFieldChars: opts.maxFieldChars ?? undefined,
      }),
    });
  }

  if (matches.length !== 1) {
    const filter = opts.session
      ? `session ${opts.session}`
      : opts.familiar
        ? `familiar ${opts.familiar}`
        : "all conversations";
    const ids = matches.map(({ conv }) => conv.sessionId).slice(0, 10).join(", ");
    const suffix = matches.length > 10 ? ", ..." : "";
    process.stderr.write(
      `error: ${filter} matched ${matches.length} conversation(s); HFR ingests one JSONL file as one trace. Re-run with --session <id>.${ids ? ` Matched: ${ids}${suffix}.` : ""}\n`,
    );
    process.exit(1);
    return;
  }

  const [{ conv, events }] = matches;
  const jsonl = serializeHfrJsonl(events);
  if (opts.out) {
    writeFileSync(opts.out, jsonl);
    process.stderr.write(
      `wrote ${events.length} events from session ${conv.sessionId} → ${opts.out}\n`,
    );
  } else {
    process.stdout.write(jsonl);
    process.stderr.write(`# ${events.length} events from session ${conv.sessionId}\n`);
  }
}

main();
