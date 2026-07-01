// @ts-nocheck
import assert from "node:assert/strict";

import {
  buildInitialTaskChatPrompt,
  buildTaskAwarePrompt,
  buildTaskContext,
} from "./task-chat-context.ts";

const context = buildTaskContext({
  title: "Fix linked session awareness",
  notes: "Follow-up chat turns need the task details.",
  status: "running",
  priority: "high",
  labels: ["chat", "tasks"],
  links: ["https://github.com/OpenCoven/coven-cave/pull/1"],
  github: [
    {
      title: "Task chat bug",
      url: "https://github.com/OpenCoven/coven-cave/issues/2",
    },
  ],
});

assert.match(context, /Task context:/);
assert.match(context, /Title: Fix linked session awareness/);
assert.match(context, /Status: running/);
assert.match(context, /Priority: high/);
assert.match(context, /Labels: chat, tasks/);
assert.match(context, /Notes:\nFollow-up chat turns need the task details\./);
assert.match(context, /Links:\n- https:\/\/github\.com\/OpenCoven\/coven-cave\/pull\/1/);
assert.match(context, /GitHub:\n- Task chat bug: https:\/\/github\.com\/OpenCoven\/coven-cave\/issues\/2/);

const prompt = buildTaskAwarePrompt("What should I do next?", context);
assert.match(prompt, /^Task context:/);
assert.match(prompt, /Current user message:\nWhat should I do next\?$/);
assert.equal(buildTaskAwarePrompt("Plain chat", null), "Plain chat");

const initialPrompt = buildInitialTaskChatPrompt({
  title: "Start from board",
  status: "backlog",
  priority: "medium",
});
assert.match(initialPrompt, /^Task context:\nTitle: Start from board/);
assert.match(initialPrompt, /Use this session as the working thread for the task\.$/);
// No attachments → no "Attached files" section.
assert.doesNotMatch(initialPrompt, /Attached files:/);

// Cards with attachments fold them into the initial dispatch prompt so the
// familiar working the task can read them. Text bodies render in full; images
// (stored lean, dataUrl stripped) render as a metadata line.
const promptWithAttachments = buildInitialTaskChatPrompt({
  title: "Ship the onboarding flow",
  status: "backlog",
  priority: "high",
  attachments: [
    { name: "spec.md", type: "text/markdown", size: 24, text: "# Onboarding\n- step one" },
    { name: "mockup.png", type: "image/png", size: 4096 },
  ],
});
assert.match(promptWithAttachments, /^Task context:\nTitle: Ship the onboarding flow/);
assert.match(promptWithAttachments, /Use this session as the working thread for the task\./);
assert.match(promptWithAttachments, /Attached files:/);
assert.match(promptWithAttachments, /1\. spec\.md/);
assert.match(promptWithAttachments, /# Onboarding\n- step one/);
assert.match(promptWithAttachments, /2\. mockup\.png/);
