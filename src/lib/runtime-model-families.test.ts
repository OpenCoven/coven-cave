import assert from "node:assert/strict";
import { newestRuntimeModelFamilies } from "./runtime-model-families.ts";

const ids = [
  "openai/gpt-5.6-sol", "openai/gpt-6-sol", "openai/gpt-6.1-sol",
  "openai/gpt-6-astra", "openai/gpt-5.6-luna", "openai/gpt-6-luna",
  "openai/gpt-5.6-terra", "openai/gpt-5.4-mini", "openai/gpt-5.3-codex-spark",
  "github/gpt-6-sol", "github/auto", "custom/my-deployment",
  "anthropic/claude-opus-4-8", "anthropic/claude-opus-5", "anthropic/claude-opus-5-5",
  "anthropic/claude-fable-5", "anthropic/claude-fable-5-1",
  "anthropic/claude-haiku-4-5", "anthropic/claude-haiku-4-5-20251001",
  "anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-5",
  "gemini-3-pro", "gemini-3.1-pro", "gemini-3-flash",
  "grok-4", "grok-4.5", "grok-4-fast",
];
const models = ids.map((id) => ({ id, label: id }));
assert.deepEqual(newestRuntimeModelFamilies(models).map((model) => model.id), [
  "openai/gpt-6.1-sol", "openai/gpt-6-astra", "openai/gpt-6-luna",
  "openai/gpt-5.6-terra", "openai/gpt-5.4-mini", "openai/gpt-5.3-codex-spark",
  "github/gpt-6-sol", "github/auto", "custom/my-deployment",
  "anthropic/claude-opus-5-5", "anthropic/claude-fable-5-1",
  "anthropic/claude-haiku-4-5-20251001", "anthropic/claude-sonnet-5",
  "gemini-3.1-pro", "gemini-3-flash", "grok-4.5", "grok-4-fast",
]);
assert.equal(models.length, ids.length, "history/catalog input is not mutated");
const snapshots = [
  "claude-3-5-sonnet-20241022", "claude-sonnet-5", "claude-sonnet-4-6",
  "claude-opus-5-20260101", "claude-opus-5-1",
  "gpt-5-2025-08-07", "gpt-5.1", "gpt-5-latest",
  "gemini-2.5-pro-preview-06-05", "gemini-3-pro-preview", "gemini-3-pro",
  "grok-4-0709", "grok-4.5", "custom/unchanged-release-name",
];
assert.deepEqual(newestRuntimeModelFamilies(snapshots.map((id) => ({ id, label: id }))).map(({ id }) => id), [
  "claude-sonnet-5", "claude-opus-5-1", "gpt-5.1", "gemini-3-pro", "grok-4.5", "custom/unchanged-release-name",
], "legacy family names, snapshots, previews, and latest aliases cannot keep older releases in menus");
assert.deepEqual(newestRuntimeModelFamilies([
  { id: "claude-opus-5-9", label: "old" }, { id: "claude-opus-5-10", label: "new" },
]), [{ id: "claude-opus-5-10", label: "new" }], "versions compare numerically");
assert.deepEqual(newestRuntimeModelFamilies([
  { id: "anthropic/claude-mythos-5", label: "old supported release" },
  { id: "anthropic/claude-mythos-5-1", label: "new supported release" },
]), [{ id: "anthropic/claude-mythos-5-1", label: "new supported release" }], "a family recognized by the Claude adapter uses the same newest-release menu policy");
for (const ids of [
  ["github/claude-opus-4.8-fast", "github/claude-opus-5.5"],
  ["github/claude-opus-5.5-fast", "github/claude-opus-5.5"],
  ["github/claude-opus-5.5", "github/claude-opus-5.5-fast"],
]) {
  assert.deepEqual(newestRuntimeModelFamilies(ids.map((id) => ({ id, label: id }))).map(({ id }) => id),
    ["github/claude-opus-5.5"], "Claude fast mode cannot keep an older release or duplicate the newest family choice");
}
assert.deepEqual(newestRuntimeModelFamilies([
  { id: "claude-opus-4-8", label: "old" }, { id: "claude-opus-5-5-fast", label: "new fast" },
]), [{ id: "claude-opus-5-5-fast", label: "new fast" }], "retain the newest discovered release even if only its fast mode is offered");
console.log("runtime-model-families.test.ts: ok");
