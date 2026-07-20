// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPromptWithAttachments,
  IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE,
  MAX_ATTACHMENT_IMAGE_BYTES,
  normalizeChatAttachments,
} from "../../../../lib/chat-attachments.ts";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  ToolCallTracker,
  toPersistedTools,
} from "../../../../lib/chat-tool-events.ts";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const streamEvents = await readFile(
  new URL("../../../../lib/stream-events.ts", import.meta.url),
  "utf8",
);
const openclawBridge = await readFile(
  new URL("../../../../lib/openclaw-bridge.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);
const chatView = await readFile(
  new URL("../../../../components/chat-view.tsx", import.meta.url),
  "utf8",
);
// ── Copilot JSONL stream wiring (cave-yesg) ──────────────────────────────────
// `coven run copilot --stream-json` launches the CLI one-shot and pipes raw
// prose, so tool calls never reach the chat. Copilot chats must spawn the CLI
// directly with its manifest-declared stream args and parse its JSONL events;
// every other adapter (and SSH runtimes) keeps the coven run path.

assert.match(
  chatRoute,
  /import \{[\s\S]*?copilotStreamSpec,[\s\S]*?\} from "@\/lib\/copilot-stream";/,
  "Chat send should source copilot stream wiring from the shared copilot-stream lib",
);

assert.match(
  chatRoute,
  /const copilotStream =\s*\n?\s*!sshRuntime && binding\.harness === "copilot" \? copilotStreamSpec\(\) : null;/,
  "The copilot stream path is gated to local copilot chats and falls back to passthrough when the manifest stops declaring stream mode",
);

assert.match(
  chatRoute,
  /const \{ command, fixedArgs \} = copilotStream\s*\n?\s*\? \{ command: copilotStream\.executable, fixedArgs: \[\] as string\[\] \}\s*\n?\s*: hermesDirect\s*\n?\s*\? \{\s*\n?\s*command: process\.platform === "win32" \? "hermes\.exe" : "hermes",[\s\S]*?: covenLaunchCommand\(\);/,
  "Copilot and Hermes direct turns spawn their own CLI; other local harnesses spawn coven",
);

assert.match(
  chatRoute,
  /if \(copilotStream\) \{\s*\n\s*handleCopilotLine\(line, isJson\);\s*\n\s*return;/,
  "Copilot stdout routes through the copilot JSONL handler, never the AssistantFilter (raw JSON frames must not leak into the bubble)",
);

assert.match(
  chatRoute,
  /const isJson = !hermesDirect && line\.startsWith\("\{"\) && line\.endsWith\("\}"\);/,
  "Hermes direct stdout must stay plain text even when an assistant reply looks like a JSON object",
);

assert.match(
  chatRoute,
  /copilotIdentityPreamble\(\s*\n?\s*body\.familiarId,/,
  "The direct copilot spawn bypasses `coven run --familiar`, so the route must mirror coven's identity preamble itself",
);

assert.match(
  chatRoute,
  /No session, task, or name matched/,
  "Copilot --resume misses (e.g. pre-stream conversations whose harnessSessionId lives in coven's store) must trigger the transparent fresh-session retry",
);

assert.match(
  chatRoute,
  /copilotText\.reset\(\);/,
  "The resume retry must clear per-attempt copilot text-dedup state alongside the tracker",
);

assert.match(
  chatRoute,
  /const a = \["run", binding\.harness, "--stream-json"\];/,
  "Adapters without a Cave-known stream protocol keep the coven run passthrough fallback",
);

console.log("copilot stream routing tests passed");

console.log("harness-routing tests passed");

