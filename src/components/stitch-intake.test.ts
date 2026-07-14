// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const intake = readFileSync(new URL("./stitch-intake.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./grimoire-view.tsx", import.meta.url), "utf8");
const knowledgeRoute = readFileSync(new URL("../app/api/knowledge/route.ts", import.meta.url), "utf8");

describe("stitch intake panel", () => {
  it("captures pins server-side through the stitches API", () => {
    assert.match(intake, /fetch\("\/api\/stitches", \{\s*method: "POST"/, "threads are created lazily");
    assert.match(intake, /fetch\("\/api\/stitches\/pins"/, "pin capture goes through the server");
    assert.match(intake, /threadId: active\.id/, "pins append to the active thread");
    assert.doesNotMatch(intake, /fetch\(ref\b/, "the client never fetches pinned URLs itself");
  });

  it("offers every v1 source kind", () => {
    assert.match(intake, /PIN_KINDS\.map/, "source picker renders one control per pin kind");
    for (const kind of ["url", "paste", "file", "chat", "github", "memory"]) {
      assert.match(intake, new RegExp(`${kind}:`), `${kind} has UI config`);
    }
    assert.match(intake, /\/api\/sessions\/list/, "chat pins pick from real sessions");
  });

  it("autofills GitHub refs with the GitHub URL prefix", () => {
    assert.match(intake, /const GITHUB_SOURCE_PREFIX = "https:\/\/github\.com\/";/, "the prefix is a named constant");
    assert.match(intake, /setRef\(defaultRefForKind\(k\)\)/, "choosing GitHub primes the source field");
    assert.match(intake, /setRef\(defaultRefForKind\(kind\)\)/, "adding another GitHub pin restores the prefix");
    assert.match(intake, /kind === "github" && sourceRef === GITHUB_SOURCE_PREFIX/, "the prefix alone is not submitted");
  });

  it("sews agentically, in chat, and manually", () => {
    assert.match(intake, /fetch\("\/api\/stitches\/sew"/, "agentic + manual sew post to the sew route");
    assert.match(intake, /mode,\s*title,/, "the sew carries the latest working title");
    assert.match(intake, /sew\("agentic"\)/, "agentic sew action");
    assert.match(intake, /sew\("manual"\)/, "manual sew action");
    assert.match(intake, /new CustomEvent\("cave:agents-new-chat"/, "sew-in-chat dispatches a primed chat");
    assert.match(intake, /buildSewChatPrompt/, "the chat is seeded with a pin digest");
    assert.match(intake, /disabled=\{pins\.length === 0 \|\| busy\}/, "sewing needs at least one pin");
  });

  it("aims the sew at a shape and a destination (cave-kwx4)", () => {
    assert.match(intake, /STITCH_PATTERNS\.map/, "pattern picker renders one chip per pattern");
    assert.match(intake, /aria-pressed=\{patternId === p\.id\}/, "pattern chips expose their state");
    assert.match(intake, /prev === p\.id \? null : p\.id/, "re-selecting a pattern clears it");
    assert.match(intake, /\.\.\.\(patternId \? \{ patternId \} : \{\}\)/, "the sew carries the pattern");
    assert.match(intake, /\.\.\.\(collection \? \{ collection \} : \{\}\)/, "the sew carries the destination");
    assert.match(intake, /\/api\/knowledge\/collections/, "destinations come from real collections");
    assert.match(intake, />Vault root<\/option>/, "root stays the default destination");
  });

  it("closes the sew-in-chat round trip (cave-x1za)", () => {
    assert.match(intake, /threadId: thread\.id,/, "the chat brief carries the real thread id");
    assert.match(intake, /useRefreshOnFocus/, "re-focus re-reads the thread");
    assert.match(intake, /latest\.sewnEntryId/, "a chat-sewn thread hands its entry to the tab swap");
    assert.match(intake, /Thread sewn from chat/, "the handoff is announced");
  });

  it("stays accessible: announcer, alerts, keyboard-first affordances", () => {
    assert.match(intake, /useAnnouncer/, "capture/sew results are announced");
    assert.match(intake, /role="alert"/, "errors surface as alerts");
    // Pin removal is two-step (cave-exbq): the label carries the armed state.
    assert.match(intake, /: `Remove pin \$\{pin\.title\}`/, "pin removal is labelled");
    assert.match(intake, /Really remove pin \$\{pin\.title\}\? Click again to confirm/, "arming is announced in the accessible name");
    assert.match(intake, /setArmedPinId\(null\), 4000/, "arming auto-disarms");
    assert.match(intake, /aria-pressed=\{kind === k\}/, "the source picker exposes its state");
    assert.doesNotMatch(intake, /hover-reveal|opacity-0/, "no hover-only affordances");
  });
});

describe("stitch provenance strip", () => {
  it("links pins back to their sources by kind", () => {
    assert.match(intake, /export function StitchProvenance/, "sewn entries show their pins");
    assert.match(intake, /pin\.kind === "url" \|\| pin\.kind === "github"/, "web pins open externally");
    assert.match(intake, /rel="noreferrer noopener"/, "external links are rel-guarded");
    assert.match(intake, /pin\.kind === "memory" \|\| pin\.kind === "file"/, "doc pins reopen in the Grimoire");
    assert.match(intake, /aria-label="Sewn from pins"/, "the strip is a labelled region");
  });

  it("is wired into the Grimoire's knowledge tab", () => {
    assert.match(view, /entry\?\.pins\?\.length \? \(\s*<StitchProvenance/, "entries with pins render the strip");
    assert.match(view, /onOpenMemory=\{\(path\) => openDoc\(\{ kind: "memory", path \}\)\}/, "memory pins deep-link");
  });

  it("survives editor saves — the knowledge route carries pins through", () => {
    assert.match(
      knowledgeRoute,
      /existing\?\.pins && existing\.pins\.length > 0 \? \{ pins: existing\.pins \}/,
      "POST /api/knowledge preserves stitch provenance the body doesn't carry",
    );
  });
});

describe("grimoire stitch integration", () => {
  it("adds the stitch-new selection without breaking persistence or deep links", () => {
    assert.match(view, /kind: "stitch-new"/, "the intake opens as a tab");
    assert.match(view, /t\.kind !== "knowledge-new" && t\.kind !== "stitch-new"/, "drafts are not persisted");
    assert.match(view, /if \(sel\.kind === "stitch-new"\) return "New stitch";/, "the tab is labelled");
    assert.match(view, /<StitchIntake/, "the intake panel renders for stitch-new");
    assert.match(view, /replaceTab\(key, \{ kind: "knowledge", id: entryId \}\)/, "a sewn entry replaces the intake tab");
  });

  it("renames Knowledge to Stitches in user-facing copy only", () => {
    assert.match(view, /label="Stitches"/, "the rail section is Stitches");
    assert.match(view, /Delete this stitch\?/, "delete confirm uses the new vocabulary");
    assert.match(view, /Stitch deleted/, "delete announce uses the new vocabulary");
    assert.match(view, /kind: "knowledge"/, "internal ids/hash kinds stay stable for deep links");
    assert.match(view, /GRIMOIRE_HASH_PREFIX/, "hash routing unchanged");
  });
});
