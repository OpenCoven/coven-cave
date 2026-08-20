// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  contextualizeNextPaths,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);

const directive = buildNextPathsDirective();
assert.match(directive, /append exactly 4 short typed suggested next steps/i);
assert.match(directive, /normally make the first two suggestions replies/i);
assert.match(directive, /\[reply:recommended\]/);
assert.match(directive, /\[action:save-link:recommended\]/);
assert.match(directive, /\[action:open-tasks\]/);
assert.match(directive, /only when useful/i);
assert.match(directive, /valid HTTP\(S\) URL/);
assert.match(directive, /presentation only/i);
assert.doesNotMatch(directive, /\[action:open-changes\]/);

assert.match(buildNextPathsDirective(2), /up to 2 short typed suggested next steps/i);
assert.equal(buildNextPathsDirective(0), "");

const supportedCases: Array<[string, NextPath]> = [
  [
    'Answer.\n<coven:next-paths>\n- [reply:recommended rationale="Keeps momentum" evidence="message:turn-1"] Draft the follow-up response\n</coven:next-paths>',
    {
      kind: "reply",
      label: "Draft the follow-up response",
      prompt: "Draft the follow-up response",
      recommended: true,
      metadata: {
        rationale: "Keeps momentum",
        evidenceRefs: [{ id: "turn-1", kind: "message", label: "Recent chat message" }],
      },
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [reply] Ask a clarifying question about the request\n</coven:next-paths>",
    {
      kind: "reply",
      label: "Ask a clarifying question about the request",
      prompt: "Ask a clarifying question about the request",
      recommended: false,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [task] Open the follow-up task tracker\n</coven:next-paths>",
    {
      kind: "task",
      label: "Open the follow-up task tracker",
      prompt: "Open the follow-up task tracker",
      recommended: false,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [task:recommended] Open the follow-up task tracker\n</coven:next-paths>",
    {
      kind: "task",
      label: "Open the follow-up task tracker",
      prompt: "Open the follow-up task tracker",
      recommended: true,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [action:open-tasks] Review open tasks for this project\n</coven:next-paths>",
    {
      kind: "action",
      actionId: "open-tasks",
      label: "Review open tasks for this project",
      prompt: "Review open tasks for this project",
      recommended: false,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [action:open-tasks:recommended] Review open tasks for this project\n</coven:next-paths>",
    {
      kind: "action",
      actionId: "open-tasks",
      label: "Review open tasks for this project",
      prompt: "Review open tasks for this project",
      recommended: true,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [action:save-link] Save the cited link to notes\n</coven:next-paths>",
    {
      kind: "action",
      actionId: "save-link",
      label: "Save the cited link to notes",
      prompt: "Save the cited link to notes",
      recommended: false,
    },
  ],
  [
    "Answer.\n<coven:next-paths>\n- [action:save-link:recommended] Save the cited link to notes\n</coven:next-paths>",
    {
      kind: "action",
      actionId: "save-link",
      label: "Save the cited link to notes",
      prompt: "Save the cited link to notes",
      recommended: true,
    },
  ],
];

for (const [text, expected] of supportedCases) {
  const r = extractNextPaths(text);
  assert.deepEqual(r.suggestions, [expected], text);
}

const legacyAndMalformed = extractNextPaths(
  "Answer.\n<coven:next-paths>\n- Legacy answer\n- [action:delete-everything] Unsafe action\n- [reply:recommendedx] Misleading suffix\n- [unsupported] Malformed intent\n</coven:next-paths>",
);
assert.deepEqual(legacyAndMalformed.suggestions, [
  { kind: "reply", label: "Legacy answer", prompt: "Legacy answer", recommended: false },
  { kind: "reply", label: "Unsafe action", prompt: "Unsafe action", recommended: false },
  { kind: "reply", label: "Misleading suffix", prompt: "Misleading suffix", recommended: false },
  { kind: "reply", label: "Malformed intent", prompt: "Malformed intent", recommended: false },
]);

for (const partial of ["[", "[action", "[action:open-tasks", "[action:save-link:recomm"]) {
  const closed = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${partial}\n</coven:next-paths>`);
  assert.deepEqual(closed.suggestions, [], `withhold partial control prefix in closed block: ${partial}`);
}

for (const partial of ["[", "[action", "[action:open-tasks", "[action:save-link:recomm"]) {
  const streaming = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${partial}`);
  assert.equal(streaming.visible, "Answer.");
  assert.deepEqual(streaming.suggestions, [], `withhold partial control prefix while streaming: ${partial}`);
}

const templateEcho = extractNextPaths(
  "Answer.\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up message\n- [reply] Ask a clarifying question\n- [task] Open the follow-up task\n- [action:save-link:recommended] Save the cited link\n</coven:next-paths>",
);
assert.deepEqual(templateEcho.suggestions, []);

const legacyTemplateEcho = extractNextPaths(
  "Answer.\n<coven:next-paths>\n- Draft the follow-up message (imperative, <= ~7 words)\n- second next step\n</coven:next-paths>",
);
assert.deepEqual(legacyTemplateEcho.suggestions, []);

const longerLabel = extractNextPaths(
  "Answer.\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up message for the user\n- [action:save-link:recommended] Save the cited link in the project notes\n</coven:next-paths>",
);
assert.deepEqual(longerLabel.suggestions, [
  {
    kind: "reply",
    label: "Draft the follow-up message for the user",
    prompt: "Draft the follow-up message for the user",
    recommended: true,
  },
  {
    kind: "action",
    actionId: "save-link",
    label: "Save the cited link in the project notes",
    prompt: "Save the cited link in the project notes",
    recommended: true,
  },
]);

const sixLines = extractNextPaths(
  "Answer.\n<coven:next-paths>\n- [reply:recommended] One\n- [reply] Two\n- [task:recommended] Three\n- [action:open-tasks] Four\n- [action:save-link] Five\n- [task] Six\n</coven:next-paths>",
);
assert.deepEqual(sixLines.suggestions, [
  { kind: "reply", label: "One", prompt: "One", recommended: true },
  { kind: "reply", label: "Two", prompt: "Two", recommended: false },
  { kind: "task", label: "Three", prompt: "Three", recommended: true },
  { kind: "action", actionId: "open-tasks", label: "Four", prompt: "Four", recommended: false },
]);

const fenced = [
  "- ```text",
  "  <coven:next-paths>",
  "  - [reply] Literal example",
  "  </coven:next-paths>",
  "  ```",
].join("\n");
const unclosedFence = extractNextPaths(
  `${fenced}\n<coven:next-paths>\n- [reply] Continue the work\n</coven:next-paths>`,
);
assert.equal(unclosedFence.visible, fenced);
assert.deepEqual(unclosedFence.suggestions, [
  { kind: "reply", label: "Continue the work", prompt: "Continue the work", recommended: false },
]);

const contextualized = contextualizeNextPaths(
  [{ kind: "reply", label: "Run the focused tests", prompt: "Run the focused tests", recommended: false }],
  {
    messageId: "turn-1",
    taskId: "task-1",
    toolOutcomeIds: ["tool-1", "tool-2"],
  },
);
assert.deepEqual(contextualized[0], {
  kind: "reply",
  label: "Run the focused tests",
  prompt: "Run the focused tests",
  recommended: false,
  metadata: {
    rationale: "Suggested from the latest assistant response.",
    evidenceRefs: [
      { id: "turn-1", kind: "message", label: "Latest assistant response" },
      { id: "task-1", kind: "task", label: "Linked task" },
      { id: "tool-1", kind: "artifact", label: "Recent tool outcome" },
    ],
  },
});

const contextualizedClaim = contextualizeNextPaths(
  [
    {
      kind: "reply",
      label: "Run the focused tests",
      prompt: "Run the focused tests",
      recommended: true,
      metadata: {
        rationale: "Model-supplied context",
        evidenceRefs: [
          { id: "message-not-in-context", kind: "message", label: "Recent chat message" },
          { id: "artifact-not-in-context", kind: "artifact", label: "Recent tool outcome" },
        ],
      },
    },
  ],
  { messageId: "0f4d5c55-6f15-4e7c-a1f4-3462fb56e5c4", taskId: "task-1", toolOutcomeIds: ["1e3c2f11-17de-4e01-aab2-35b9f4e2b555"] },
);
assert.deepEqual(contextualizedClaim[0]?.metadata?.evidenceRefs, [
  { id: "0f4d5c55-6f15-4e7c-a1f4-3462fb56e5c4", kind: "message", label: "Latest assistant response" },
  { id: "task-1", kind: "task", label: "Linked task" },
  { id: "1e3c2f11-17de-4e01-aab2-35b9f4e2b555", kind: "artifact", label: "Recent tool outcome" },
]);

console.log("next-paths.test.ts: ok");
