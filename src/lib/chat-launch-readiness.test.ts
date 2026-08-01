// @ts-nocheck
import assert from "node:assert/strict";

const readinessModule = await import("./chat-launch-readiness.ts").catch(() => null);
assert.ok(
  readinessModule?.deriveChatLaunchReadiness,
  "chat launch readiness should have one shared derivation",
);
assert.ok(
  readinessModule?.isModelReadyForChatSend,
  "chat send readiness should distinguish initial launch from established conversations",
);
assert.ok(
  readinessModule?.hasChatStarted,
  "chat send readiness should ignore local-only system rows",
);

const { deriveChatLaunchReadiness, hasChatStarted, isModelReadyForChatSend } = readinessModule;
const selectedModel = {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  effectiveModel: "anthropic/claude-opus-4-8",
  source: "familiar-default",
  applicationState: "saved",
};

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: true,
    projectDetail: "Coven Cave",
    modelStatus: "loading",
    modelState: null,
  }),
  {
    ready: false,
    requirements: [
      { id: "project", ready: true, label: "Project", detail: "Coven Cave" },
      {
        id: "model",
        ready: false,
        label: "Model",
        detail: "Resolving final model…",
      },
    ],
    modelValue: null,
  },
  "a transient model candidate must not make the initial launch ready",
);

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: false,
    projectDetail: "Choose a project this familiar can access before starting chat.",
    modelStatus: "ready",
    modelState: selectedModel,
  }),
  {
    ready: false,
    requirements: [
      {
        id: "project",
        ready: false,
        label: "Project",
        detail: "Choose a project this familiar can access before starting chat.",
      },
      {
        id: "model",
        ready: true,
        label: "Model",
        detail: "anthropic/claude-opus-4-8",
      },
    ],
    modelValue: "anthropic/claude-opus-4-8",
  },
  "project setup remains visible after the final model resolves",
);

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: true,
    projectDetail: "Coven Cave",
    modelStatus: "ready",
    modelState: {
      ...selectedModel,
      effectiveModel: "",
      source: "runtime-default",
    },
  }),
  {
    ready: true,
    requirements: [
      { id: "project", ready: true, label: "Project", detail: "Coven Cave" },
      { id: "model", ready: true, label: "Model", detail: "Runtime default" },
    ],
    modelValue: "",
  },
  "an explicitly resolved runtime default is a final model selection",
);

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: true,
    projectDetail: "Coven Cave",
    modelStatus: "loading",
    modelState: null,
    modelOverride: "openai/gpt-5.6-sol",
  }),
  {
    ready: true,
    requirements: [
      { id: "project", ready: true, label: "Project", detail: "Coven Cave" },
      { id: "model", ready: true, label: "Model", detail: "openai/gpt-5.6-sol" },
    ],
    modelValue: "openai/gpt-5.6-sol",
  },
  "an explicit handoff override is already the final model for the first send",
);

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: true,
    projectDetail: "Coven Cave",
    modelStatus: "loading",
    modelState: null,
    modelOverride: "",
  }),
  {
    ready: true,
    requirements: [
      { id: "project", ready: true, label: "Project", detail: "Coven Cave" },
      { id: "model", ready: true, label: "Model", detail: "Runtime default" },
    ],
    modelValue: "",
  },
  "an explicit runtime-default handoff remains distinct from an unresolved model",
);

assert.equal(
  isModelReadyForChatSend({ hasStarted: false, modelValue: null }),
  false,
  "the initial send waits for final model resolution",
);
assert.equal(
  isModelReadyForChatSend({ hasStarted: true, modelValue: null }),
  true,
  "an established conversation remains sendable while model state refreshes",
);
assert.equal(
  isModelReadyForChatSend({ hasStarted: false, modelValue: null, modelOverride: "" }),
  true,
  "an explicit runtime-default override can launch the initial send",
);
assert.equal(
  hasChatStarted([{ role: "system" }]),
  false,
  "local system rows do not bypass initial launch readiness",
);
assert.equal(
  hasChatStarted([{ role: "system" }, { role: "user" }]),
  true,
  "a real user turn marks the chat as started",
);

assert.deepEqual(
  deriveChatLaunchReadiness({
    projectReady: true,
    projectDetail: "Coven Cave",
    modelStatus: "error",
    modelState: null,
  }).requirements[1],
  {
    id: "model",
    ready: false,
    label: "Model",
    detail: "Choose a model before sending.",
  },
  "a failed model-state lookup gives an actionable setup step",
);

console.log("chat-launch-readiness.test.ts: ok");
