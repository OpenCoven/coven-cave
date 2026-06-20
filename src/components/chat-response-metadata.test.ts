// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatRuntime } from "../lib/chat-response-metadata.ts";

const chatRoute = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const conversations = await readFile(new URL("../lib/cave-conversations.ts", import.meta.url), "utf8");
const sessionMerge = await readFile(new URL("../lib/session-list-merge.ts", import.meta.url), "utf8");
const types = await readFile(new URL("../lib/types.ts", import.meta.url), "utf8");

assert.match(
  chatRoute,
  /type StreamEvent =[\s\S]*kind: "done";[\s\S]*responseMetadata\?: ChatResponseMetadata/,
  "Chat send done events should carry explicit response metadata",
);

assert.match(
  chatRoute,
  /const responseMetadata: ChatResponseMetadata = \{[\s\S]*familiarId: body\.familiarId,[\s\S]*harness: binding\.harness,[\s\S]*model: desiredModel,[\s\S]*runtime:/,
  "Coven harness responses should derive metadata from the desired model and actual runtime",
);

assert.match(
  chatRoute,
  /kind: "done",[\s\S]*responseMetadata,/,
  "Final done events should include response metadata in the SSE payload",
);

assert.match(
  chatRoute,
  /const assistantTurn: ChatTurn = \{[\s\S]*responseMetadata,/,
  "Persisted assistant turns should store the response metadata that produced them",
);

assert.match(
  chatRoute,
  /model: responseMetadata\.model,[\s\S]*runtime: responseMetadata\.runtime,/,
  "Saved conversations should keep session-level model and runtime metadata",
);

assert.match(
  chatRoute,
  /openClawChatResponse\(\{[\s\S]*desiredModel,[\s\S]*modelState,/,
  "OpenClaw bridge responses should receive desired model state for response metadata",
);

assert.match(
  chatRoute,
  /modelOverride\?: string/,
  "SendBody should accept a modelOverride without treating it as global config",
);
assert.match(
  chatRoute,
  /modelOverrideScope\?: "next-message" \| "session"/,
  "SendBody should distinguish next-message and session-scoped model intent",
);
assert.match(
  chatRoute,
  /desiredModel:/,
  "Response metadata should carry desired model separately from confirmed model",
);
assert.match(
  chatRoute,
  /const desiredModel = modelState\.effectiveModel === "unknown" \? args\.binding\.model : modelState\.effectiveModel;/,
  "Desired model should come from resolved model state so source and model cannot diverge",
);
assert.match(
  chatRoute,
  /const sessionModel =[\s\S]*args\.body\.modelOverrideScope === "session"[\s\S]*\? requestedModel[\s\S]*: args\.existingConversation\?\.modelIntent\?\.model \?\? null;/,
  "Session-scoped send overrides should flow through the same model-state source as desiredModel",
);
assert.match(
  chatRoute,
  /modelApplicationState:/,
  "Response metadata should carry application state for honest UI rendering",
);
assert.doesNotMatch(
  chatRoute,
  /saveConfig\([\s\S]*modelOverride/,
  "Chat send must not mutate Cave config from a one-off or session model override",
);

assert.match(
  chatView,
  /type StreamEvent =[\s\S]*kind: "done";[\s\S]*responseMetadata\?: ChatResponseMetadata/,
  "ChatView should accept response metadata from done events",
);

assert.match(
  chatView,
  /responseMetadata\?: ChatResponseMetadata/,
  "Chat turns should carry response metadata for per-response display",
);

assert.match(
  chatView,
  /case "done":[\s\S]*responseMetadata: ev\.responseMetadata,/,
  "Done handling should store response metadata on the settled assistant turn",
);

assert.match(
  chatView,
  /durationMs: t\.durationMs,[\s\S]*responseMetadata: t\.responseMetadata,/,
  "History loading should restore persisted response metadata",
);

assert.match(
  chatView,
  /formatRuntime\(args\.runtime\)/,
  "Chat header should render the runtime honestly as a working directory (no dishonest 'model:'/'runtime:' labels)",
);
assert.doesNotMatch(
  chatView,
  /modelLabel|runtimeLabel/,
  "The misleading 'model:'/'runtime:' label helpers should be gone — openclaw-local is not a model and the runtime is a cwd",
);

assert.doesNotMatch(
  chatView,
  /ResponseMetadataText/,
  "The model/runtime metadata no longer renders inline in the turn meta row — it lives in the debug pane's per-turn JSON",
);

assert.match(
  chatView,
  /metadata\?\.confirmedModel\?\.trim\(\)[\s\S]*metadata\?\.model\?\.trim\(\)/,
  "Response metadata display should prefer the runtime-confirmed model over the requested model",
);
assert.doesNotMatch(
  chatView,
  /openclaw-local/,
  "ChatView should not hardcode the old synthetic OpenClaw model placeholder",
);

assert.match(
  conversations,
  /model\?: string;[\s\S]*runtime\?: string;/,
  "Conversation files should persist session-level model and runtime metadata",
);

assert.match(
  conversations,
  /responseMetadata\?: ChatResponseMetadata/,
  "Conversation turns should persist response metadata",
);

assert.match(
  sessionMerge,
  /\.\.\.\(conv\.model \? \{ model: conv\.model \} : \{\}\),[\s\S]*\.\.\.\(conv\.runtime \? \{ runtime: conv\.runtime \} : \{\}\),/,
  "Local conversation session rows should expose saved model and runtime",
);

assert.match(
  types,
  /model\?: string \| null;[\s\S]*runtime\?: string \| null;/,
  "Session rows should carry optional model/runtime metadata",
);

// formatRuntime turns the opaque `runtime` value into an honest working
// directory: scheme stripped, home collapsed to ~, long paths left-truncated
// so the repo folder survives. The full path stays in the tooltip title.
{
  const local = formatRuntime("local:/Users/buns/Documents/GitHub/OpenCoven/coven-cave");
  assert.equal(local?.label, "~/…/coven-cave", "local cwd shows home-relative, repo-name-preserving");
  assert.equal(local?.title, "~/Documents/GitHub/OpenCoven/coven-cave", "tooltip keeps the full cwd");

  assert.equal(formatRuntime("local:/home/val/proj")?.label, "~/proj", "linux home collapses too");
  assert.equal(formatRuntime("local:/Users/buns")?.label, "~", "bare home is ~");
  assert.equal(formatRuntime("local:/opt/work/repo")?.label, "/opt/…/repo", "non-home absolute path keeps its root slash");

  const ssh = formatRuntime("ssh:beacon:/home/val/srv");
  assert.equal(ssh?.label, "beacon:~/srv", "ssh shows host:cwd");
  assert.match(ssh?.title ?? "", /ssh/, "ssh tooltip notes the transport");

  assert.equal(formatRuntime(""), null, "empty runtime renders nothing");
  assert.equal(formatRuntime(null), null, "missing runtime renders nothing");
  // No dishonest "model:" / "runtime:" prefixes anywhere in the label.
  assert.doesNotMatch(local?.label ?? "", /model:|runtime:/, "label carries no dishonest prefix");
}

console.log("chat-response-metadata.test.ts: ok");
