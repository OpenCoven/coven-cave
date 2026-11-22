#!/usr/bin/env node
// Read-only replay of thread-reflection parsing over stored conversations
// (#5887). Prints counts and failure classes only: never transcript text,
// never a session id, and it writes nothing.
//
// Definitions (Val chose the paired selector on 20 November 2026):
// - A *run* is a stored conversation whose first user turn is the thread
//   reflection prompt ("Here is the thread you just completed (session: ..."),
//   which `buildThreadReflectPrompt` produces. Every run counts, including
//   runs with no assistant reply (Val's all-run ruling, 9 October 2026).
// - The *paired* selector takes the first assistant reply after that prompt,
//   before any later user turn. The *plan* selector takes the last assistant
//   reply in the conversation. Turns are read in stored order.
// - Two corpora are reported. *all*: every reflection run. *replied*: runs
//   with origin "enhance" (Cave's hidden reflection run) that have at least
//   one assistant reply. *replied* reproduces the 17 October 2026 replay
//   exactly (paired 890/899, plan 886/899), so it is the corpus behind the
//   historical figures; *all* adds runs that got no reply and older runs
//   stored without an origin.
// - A run *passes* when `parseSelfReportJsonObject` from main accepts the
//   selected reply. Field validation in the self-report route is not part of
//   this gate.
//
// Usage: node scripts/reflection-replay.mjs [--dir <conversations dir>]
//        [--until YYYY-MM-DD] [--json]
// The default directory is Cave's conversations folder under COVEN_CAVE_HOME,
// COVEN_HOME/cave, or ~/.coven/cave.

import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSelfReportJsonObject } from "../src/lib/server/self-report-json.ts";

export const REFLECTION_PROMPT_PREFIX = "Here is the thread you just completed (session:";

function turnsOf(conversation) {
  return Array.isArray(conversation?.turns) ? conversation.turns : [];
}

function textOf(turn) {
  return typeof turn?.text === "string" ? turn.text : "";
}

/** The reflection prompt is the conversation's first user turn. */
export function isReflectionRun(conversation) {
  const firstUser = turnsOf(conversation).find((turn) => turn?.role === "user");
  return textOf(firstUser).trimStart().startsWith(REFLECTION_PROMPT_PREFIX);
}

export function pairedReply(conversation) {
  const turns = turnsOf(conversation);
  const promptIndex = turns.findIndex((turn) => turn?.role === "user");
  for (const turn of turns.slice(promptIndex + 1)) {
    if (turn?.role === "user") return null;
    if (turn?.role === "assistant" && textOf(turn).trim()) return textOf(turn);
  }
  return null;
}

export function planReply(conversation) {
  const replies = turnsOf(conversation).filter((turn) => turn?.role === "assistant" && textOf(turn).trim());
  return replies.length ? textOf(replies.at(-1)) : null;
}

/** "pass", or the failure class. The reply text itself is never returned. */
export function classifyReply(reply) {
  if (reply === null) return "no-reply";
  try {
    parseSelfReportJsonObject(reply);
    return "pass";
  } catch {
    return reply.includes("{") ? "invalid-object" : "no-object";
  }
}

function runDate(conversation) {
  const stamp = conversation?.createdAt ?? conversation?.updatedAt;
  return typeof stamp === "string" ? stamp.slice(0, 10) : "";
}

/** The 17 October corpus: hidden reflection runs that produced a reply. */
export function isRepliedReflectionRun(conversation) {
  return conversation?.origin === "enhance" && planReply(conversation) !== null;
}

export function tallyRuns(conversations, { until, corpus = "all" } = {}) {
  const tally = {
    runs: 0,
    unreadable: 0,
    paired: { pass: 0, "no-reply": 0, "no-object": 0, "invalid-object": 0 },
    plan: { pass: 0, "no-reply": 0, "no-object": 0, "invalid-object": 0 },
  };
  for (const conversation of conversations) {
    if (conversation === null) {
      tally.unreadable += 1;
      continue;
    }
    if (!isReflectionRun(conversation)) continue;
    if (corpus === "replied" && !isRepliedReflectionRun(conversation)) continue;
    if (until && runDate(conversation) > until) continue;
    tally.runs += 1;
    tally.paired[classifyReply(pairedReply(conversation))] += 1;
    tally.plan[classifyReply(planReply(conversation))] += 1;
  }
  return tally;
}

/** Percent rounded down to three decimals, so a near miss is never shown as a pass. */
export function ratePercent(pass, runs) {
  if (runs === 0) return "0.000";
  return (Math.floor((pass / runs) * 100_000) / 1000).toFixed(3);
}

function defaultConversationsDir() {
  const explicit = process.env.COVEN_CAVE_HOME?.trim();
  if (explicit) return path.join(explicit, "conversations");
  const covenHome = process.env.COVEN_HOME?.trim();
  if (covenHome) return path.join(covenHome, "cave", "conversations");
  return path.join(os.homedir(), ".coven", "cave", "conversations");
}

async function loadAll(dir) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const conversations = [];
  for (const name of names) {
    try {
      conversations.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
    } catch {
      conversations.push(null);
    }
  }
  return conversations;
}

async function main(argv) {
  const option = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const dir = option("--dir") ?? defaultConversationsDir();
  const until = option("--until");
  if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error("--until takes YYYY-MM-DD");
  }
  const conversations = await loadAll(dir);
  const summaries = ["replied", "all"].map((corpus) => {
    const tally = tallyRuns(conversations, { until, corpus });
    return {
      corpus,
      until: until ?? null,
      runs: tally.runs,
      unreadableFiles: tally.unreadable,
      paired: { ...tally.paired, percent: ratePercent(tally.paired.pass, tally.runs) },
      plan: { ...tally.plan, percent: ratePercent(tally.plan.pass, tally.runs) },
    };
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  for (const summary of summaries) {
    console.log(`${summary.corpus}: runs ${summary.runs}${until ? ` (created on or before ${until})` : ""}; unreadable files ${summary.unreadableFiles}`);
    for (const selector of ["paired", "plan"]) {
      const row = summary[selector];
      console.log(
        `  ${selector}: ${row.pass}/${summary.runs} (${row.percent}%) · no-reply ${row["no-reply"]} · no-object ${row["no-object"]} · invalid-object ${row["invalid-object"]}`,
      );
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
