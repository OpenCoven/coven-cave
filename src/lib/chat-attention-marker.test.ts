// Behavioral tests for the chat attention marker protocol
// (`<coven:attention …>`; chat sidebar attention task 1).
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractChatAttentionMarker,
  extractIncompleteChatAttentionMarker,
} from "./chat-attention-marker.ts";

test("extracts one explicit attention request and removes its marker", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Choose a release channel.\n<coven:attention reason="decision" />',
    ),
    {
      visible: "Choose a release channel.\n",
      request: { reason: "decision" },
    },
  );
});

test("last valid marker wins across multiple requests", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      '<coven:attention reason="input" /><coven:attention reason="approval" />',
    ).request,
    { reason: "approval" },
  );
});

test("invalid reasons are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker('Need something <coven:attention reason="urgent" />'),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("valid markers still allow ordinary whitespace variation", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Choose a release channel.\n<coven:attention   reason = "decision"\n/>',
    ),
    {
      visible: "Choose a release channel.\n",
      request: { reason: "decision" },
    },
  );
});

test("non-self-closing markers are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker('Need something <coven:attention reason="decision">'),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("prefixed reason attributes are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker('Need something <coven:attention data-reason="decision" />'),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("duplicate reason attributes are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Need something <coven:attention reason="input" reason="decision" />',
    ),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("extra attributes are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Need something <coven:attention reason="decision" actor="sage" />',
    ),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("fenced markers stay literal example text", () => {
  const text = '```\n<coven:attention reason="credentials" />\n```';
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: text,
    request: null,
  });
});

test("detects a marker after a list-contained fenced example", () => {
  const fenced = [
    "- ```typescript-react",
    '  <coven:attention reason="credentials" />',
    "  ```",
  ].join("\n");
  const text = `${fenced}\n<coven:attention reason="decision" />`;
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: `${fenced}\n`,
    request: { reason: "decision" },
  });
});

test("handles ordered and nested list fences without activating their markers", () => {
  const fenced = [
    "1. ~~~xml",
    '   <coven:attention reason="credentials" />',
    "   ~~~",
    "  - ```xml",
    '    <coven:attention reason="approval" />',
    "    ```",
  ].join("\n");
  const text = `${fenced}\n<coven:attention reason="input" />`;
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: `${fenced}\n`,
    request: { reason: "input" },
  });
});

test("an unclosed streaming list fence keeps a partial marker literal", () => {
  const text = "- ```xml\n  <coven:attention rea";
  assert.deepEqual(extractChatAttentionMarker(text, { pending: true }), {
    visible: text,
    request: null,
  });
});

test("partial streaming tails stay hidden outside code ranges", () => {
  assert.deepEqual(extractChatAttentionMarker("Waiting <coven:attention rea", { pending: true }), {
    visible: "Waiting ",
    request: null,
  });
});

test("every initial streaming marker prefix stays hidden outside code ranges", () => {
  const markerStart = "<coven:attention";
  for (let length = 1; length <= markerStart.length; length++) {
    const prefix = markerStart.slice(0, length);
    assert.deepEqual(
      extractChatAttentionMarker(`Waiting ${prefix}`, { pending: true }),
      { visible: "Waiting ", request: null },
      `hides ${JSON.stringify(prefix)} until it becomes a marker or settles as ordinary text`,
    );
  }
});

test("initial marker-like prefixes remain ordinary text after settlement", () => {
  for (const suffix of ["<", "<c", "<coven:a", "<coven:attention rea"]) {
    assert.deepEqual(
      extractChatAttentionMarker(`Comparison: value ${suffix}`),
      {
        visible: `Comparison: value ${suffix}`,
        request: null,
      },
      `preserves settled ordinary text ending in ${JSON.stringify(suffix)}`,
    );
  }
});

test("a disambiguated malformed marker name becomes visible while still streaming", () => {
  const text = "Comparison: <coven:attentionX";
  assert.deepEqual(extractChatAttentionMarker(text, { pending: true }), {
    visible: text,
    request: null,
  });
});

test("a repeated marker's initial streaming prefix stays hidden", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'First <coven:attention reason="input" /> later <coven:',
      { pending: true },
    ),
    {
      visible: "First  later ",
      request: { reason: "input" },
    },
  );
});

test("partial tails inside code ranges stay literal", () => {
  const text = "```\nWaiting <coven:attention rea\n```";
  assert.deepEqual(extractChatAttentionMarker(text, { pending: true }), {
    visible: text,
    request: null,
  });
});

test("pending extraction still strips a complete marker and returns its request", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Visible question.\n<coven:attention reason="decision" />',
      { pending: true },
    ),
    {
      visible: "Visible question.\n",
      request: { reason: "decision" },
    },
  );
});

test("pending extraction keeps malformed nonprefix tails visible", () => {
  assert.deepEqual(
    extractChatAttentionMarker("Keep malformed <coven:attentionX", { pending: true }),
    {
      visible: "Keep malformed <coven:attentionX",
      request: null,
    },
  );
});

test("malformed quoted tags never consume following settled prose or fabricate a request", () => {
  for (const text of [
    '<coven:attention" reason="decision">AFTER',
    '<coven:attention" reason="decision" />AFTER',
    '<coven:attention reason="decision"" />AFTER',
  ]) {
    assert.deepEqual(
      extractChatAttentionMarker(text, { pending: true }),
      { visible: "AFTER", request: null },
      `pending extraction recovers after ${JSON.stringify(text)}`,
    );
    assert.deepEqual(
      extractChatAttentionMarker(text),
      { visible: "AFTER", request: null },
      `settled extraction recovers after ${JSON.stringify(text)}`,
    );
    assert.deepEqual(
      extractIncompleteChatAttentionMarker(text),
      { visible: "AFTER", request: null },
      `interrupted extraction recovers after ${JSON.stringify(text)}`,
    );
  }
});

test("only a still-possible quoted marker tail stays hidden while pending", () => {
  const text = '<coven:attention reason="decision>AFTER';
  assert.deepEqual(extractChatAttentionMarker(text, { pending: true }), {
    visible: "",
    request: null,
  });
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: "AFTER",
    request: null,
  });
  assert.deepEqual(extractIncompleteChatAttentionMarker(text), {
    visible: "AFTER",
    request: null,
  });
});

test("incomplete extraction strips only marker-like tails across every fragmented boundary", () => {
  const markerStart = "<coven:attention";
  for (let length = 2; length <= markerStart.length; length++) {
    const prefix = markerStart.slice(0, length);
    assert.deepEqual(
      extractIncompleteChatAttentionMarker(`Visible ${prefix}`),
      { visible: "Visible ", request: null },
      `strips incomplete marker tail ${JSON.stringify(prefix)}`,
    );
  }
});

test("incomplete extraction preserves fenced partial markup, ordinary trailing lt text, and malformed nonprefix tails", () => {
  const fenced = "```\nVisible <coven:attent\n```";
  assert.deepEqual(extractIncompleteChatAttentionMarker(fenced), {
    visible: fenced,
    request: null,
  });
  assert.deepEqual(extractIncompleteChatAttentionMarker("Math: 2 < 3 <"), {
    visible: "Math: 2 < 3 <",
    request: null,
  });
  assert.deepEqual(extractIncompleteChatAttentionMarker("Keep malformed <coven:attentionX"), {
    visible: "Keep malformed <coven:attentionX",
    request: null,
  });
});
