import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  RESULT_ID_MAX,
  RESULT_LABEL_MAX,
  chatResultProtocolRanges,
  extractChatResultMarkers,
  extractChatResultMarkersFromScan,
  maskChatResultProtocolForMarkdown,
  scanChatResultProtocol,
} from "./chat-result-markers.ts";

const validMarker = (
  id = "build",
  state = "passed",
  label = "Build passed",
) => `<coven:result id="${id}" state="${state}" label="${label}" />`;

test("valid exact markers strip and duplicate ids update in first-seen order", () => {
  const text = [
    "Running checks.",
    validMarker("focused-tests", "running", "Focused tests"),
    '<coven:result label="Production build passed" id="build" state="passed"/>',
    validMarker("focused-tests", "passed", "Focused tests passed"),
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text, { pending: true }), {
    visible: "Running checks.\n\n\n",
    results: [
      {
        id: "focused-tests",
        label: "Focused tests passed",
        state: "passed",
        source: "familiar",
      },
      {
        id: "build",
        label: "Production build passed",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("precomputed scans extract without rescanning and reject another source", () => {
  const text = `before ${validMarker("precomputed", "passed", "Precomputed")} after`;
  const scan = scanChatResultProtocol(text);

  assert.deepEqual(
    extractChatResultMarkersFromScan(text, scan),
    extractChatResultMarkers(text),
  );
  assert.throws(
    () => extractChatResultMarkersFromScan(text.replace("before", "BEFORE"), scan),
    /exact source/,
  );
  assert.throws(
    () => extractChatResultMarkersFromScan(`${text}!`, scan),
    /exact source/,
  );
});

test("protocol scanning never creates full character or line split arrays", () => {
  const originalSplit = String.prototype.split;
  let characterSplitCalls = 0;
  let lineSplitCalls = 0;
  String.prototype.split = function (
    this: string,
    separator?: string | RegExp,
    limit?: number,
  ): string[] {
    if (separator === "") characterSplitCalls += 1;
    if (separator === "\n") lineSplitCalls += 1;
    return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
  } as typeof String.prototype.split;

  try {
    scanChatResultProtocol(
      validMarker("allocation", "passed", "Ran `pnpm test` successfully"),
    );
  } finally {
    String.prototype.split = originalSplit;
  }

  assert.equal(characterSplitCalls, 0);
  assert.equal(lineSplitCalls, 0);
});

test("valid markers may contain inline Markdown backticks in quoted labels", () => {
  const marker = validMarker("tests", "passed", "`pnpm test` passed");

  assert.deepEqual(extractChatResultMarkers(`before ${marker} after`), {
    visible: "before  after",
    results: [
      {
        id: "tests",
        label: "`pnpm test` passed",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("valid markers may contain a lone Markdown backtick in a quoted label", () => {
  const marker = validMarker("tests", "passed", "Ran `pnpm test");

  assert.deepEqual(extractChatResultMarkers(`before ${marker} after`), {
    visible: "before  after",
    results: [
      {
        id: "tests",
        label: "Ran `pnpm test",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("malformed complete markers with quoted Markdown backticks strip fully", () => {
  const marker =
    '<coven:result id="tests" state="passed" label="`pnpm test` passed" note="extra" />';

  assert.deepEqual(extractChatResultMarkers(`before ${marker} after`), {
    visible: "before  after",
    results: [],
  });
});

test("malformed complete markers with a lone quoted backtick strip fully", () => {
  const marker =
    '<coven:result id="tests" state="unknown" label="Ran `pnpm test" note="extra" />';

  assert.deepEqual(extractChatResultMarkers(`before ${marker} after`), {
    visible: "before  after",
    results: [],
  });
});

test("malformed complete markers mask unquoted backticks before strict rejection", () => {
  const malformed =
    "<coven:result id='tests' state='passed' label='Ran `pnpm test' />";
  const live = validMarker("live", "passed", "Live result");

  assert.deepEqual(
    extractChatResultMarkers(`before ${malformed} between ${live} after`),
    {
      visible: "before  between  after",
      results: [
        {
          id: "live",
          label: "Live result",
          state: "passed",
          source: "familiar",
        },
      ],
    },
  );
});

test("a complete marker backtick cannot corrupt later inline code or live markers", () => {
  const literal = validMarker("literal", "failed", "Literal");
  const live = validMarker("live", "passed", "Live result");
  const text = [
    `Before ${validMarker("first", "passed", "Ran \`pnpm test")} between.`,
    `Keep \`${literal}\` literal.`,
    `Then ${live} after.`,
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: [
      "Before  between.",
      `Keep \`${literal}\` literal.`,
      "Then  after.",
    ].join("\n"),
    results: [
      {
        id: "first",
        label: "Ran `pnpm test",
        state: "passed",
        source: "familiar",
      },
      {
        id: "live",
        label: "Live result",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a malformed complete marker backtick cannot corrupt later classifications", () => {
  const malformed =
    '<coven:result id="bad" state="unknown" label="Ran `pnpm test" note="extra" />';
  const literal = validMarker("literal", "failed", "Literal");
  const live = validMarker("live", "attention", "Needs attention");
  const text = [
    `Before ${malformed} between.`,
    `Keep \`${literal}\` literal.`,
    `Then ${live} after.`,
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: [
      "Before  between.",
      `Keep \`${literal}\` literal.`,
      "Then  after.",
    ].join("\n"),
    results: [
      {
        id: "live",
        label: "Needs attention",
        state: "attention",
        source: "familiar",
      },
    ],
  });
});

test("a quoted incomplete marker backtick strips locally without swallowing fenced code", () => {
  const literal = validMarker("literal", "failed", "Literal");
  const live = validMarker("live", "passed", "Live result");
  const text = [
    'Before <coven:result id="bad" state="passed" label="Ran `pnpm test',
    "```xml",
    literal,
    "```",
    `Then ${live} after.`,
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: [
      "Before ",
      "```xml",
      literal,
      "```",
      "Then  after.",
    ].join("\n"),
    results: [
      {
        id: "live",
        label: "Live result",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a Markdown range opening before a marker remains authoritative", () => {
  const literal = validMarker("literal", "failed", "Literal");
  const text = `Before \`${literal}\` after.`;

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: text,
    results: [],
  });
});

test("self-closing attribute validation matrix", async (t) => {
  const invalidMarkers = [
    {
      name: "duplicate attribute",
      marker: '<coven:result id="build" id="other" state="passed" label="Build" />',
    },
    {
      name: "missing id",
      marker: '<coven:result state="passed" label="Build" />',
    },
    {
      name: "missing state",
      marker: '<coven:result id="build" label="Build" />',
    },
    {
      name: "missing label",
      marker: '<coven:result id="build" state="passed" />',
    },
    {
      name: "empty id",
      marker: '<coven:result id="" state="passed" label="Build" />',
    },
    {
      name: "whitespace id",
      marker: '<coven:result id="   " state="passed" label="Build" />',
    },
    {
      name: "empty label",
      marker: '<coven:result id="build" state="passed" label="" />',
    },
    {
      name: "whitespace label",
      marker: '<coven:result id="build" state="passed" label="   " />',
    },
    {
      name: "unknown attribute",
      marker: '<coven:result id="build" state="passed" label="Build" note="extra" />',
    },
    {
      name: "unquoted attribute",
      marker: '<coven:result id=build state="passed" label="Build" />',
    },
    {
      name: "single-quoted attribute",
      marker: "<coven:result id='build' state=\"passed\" label=\"Build\" />",
    },
    {
      name: "invalid state",
      marker: '<coven:result id="build" state="unknown" label="Build" />',
    },
    {
      name: "id over limit",
      marker: validMarker("a".repeat(RESULT_ID_MAX + 1)),
    },
    {
      name: "label over limit",
      marker: validMarker("build", "passed", "b".repeat(RESULT_LABEL_MAX + 1)),
    },
    {
      name: "attribute residue",
      marker: '<coven:result id="build" state="passed" label="Build" ??? />',
    },
  ];

  for (const { name, marker } of invalidMarkers) {
    await t.test(name, () => {
      assert.deepEqual(extractChatResultMarkers(`before ${marker} after`), {
        visible: "before  after",
        results: [],
      });
    });
  }
});

test("all result states and exact limits validate", () => {
  const states = ["pending", "running", "passed", "attention", "failed"];
  const text = states
    .map((state, index) => validMarker(`id-${index}`, state, state))
    .concat(validMarker("a".repeat(RESULT_ID_MAX), "passed", "b".repeat(RESULT_LABEL_MAX)))
    .join("");

  const result = extractChatResultMarkers(text);

  assert.equal(result.visible, "");
  assert.deepEqual(result.results.map(({ id, label, state }) => ({ id, label, state })), [
    { id: "id-0", label: "pending", state: "pending" },
    { id: "id-1", label: "running", state: "running" },
    { id: "id-2", label: "passed", state: "passed" },
    { id: "id-3", label: "attention", state: "attention" },
    { id: "id-4", label: "failed", state: "failed" },
    {
      id: "a".repeat(RESULT_ID_MAX),
      label: "b".repeat(RESULT_LABEL_MAX),
      state: "passed",
    },
  ]);
});

test("result state is outer-trimmed before exact allowlist validation", () => {
  const text = [
    validMarker("trimmed", " passed ", "Trimmed state"),
    validMarker("blank", "   ", "Blank state"),
    validMarker("unknown", " unknown ", "Unknown state"),
  ].join("");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "",
    results: [
      {
        id: "trimmed",
        label: "Trimmed state",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("raw id and label lengths are bounded before trimming", () => {
  const oversizedRawId = `${" ".repeat(RESULT_ID_MAX)}x`;
  const oversizedRawLabel = `${" ".repeat(RESULT_LABEL_MAX)}x`;
  const exactRawId = ` ${"i".repeat(RESULT_ID_MAX - 2)} `;
  const exactRawLabel = ` ${"l".repeat(RESULT_LABEL_MAX - 2)} `;
  const text = [
    validMarker(oversizedRawId, "passed", "short"),
    validMarker("short", "passed", oversizedRawLabel),
    validMarker(exactRawId, "passed", exactRawLabel),
  ].join("");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "",
    results: [
      {
        id: exactRawId.trim(),
        label: exactRawLabel.trim(),
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("opening and closing protocol validation matrix strips without rows", async (t) => {
  const cases = [
    {
      name: "bare non-self-closing opener",
      text: `before ${validMarker().replace(" />", ">")} after`,
      visible: "before  after",
    },
    {
      name: "standalone closing tag",
      text: "before </coven:result> after",
      visible: "before  after",
    },
    {
      name: "malformed closing with trailing attributes",
      text: 'before </coven:result state="failed"> after',
      visible: "before  after",
    },
    {
      name: "malformed closing with trailing content",
      text: "before </coven:result broken content> after",
      visible: "before  after",
    },
    {
      name: "unterminated full closing",
      text: "before </coven:result broken content",
      visible: "before ",
    },
    {
      name: "partial closing",
      text: "before </coven:res malformed content",
      visible: "before ",
    },
    {
      name: "partial opening with trailing malformed content",
      text: "before <coven:res malformed content",
      visible: "before ",
    },
    {
      name: "unterminated full opening",
      text: 'before <coven:result id="build" state="passed"',
      visible: "before ",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.deepEqual(extractChatResultMarkers(entry.text), {
        visible: entry.visible,
        results: [],
      });
    });
  }
});

test("partial openings and closings before protected code hide locally", async (t) => {
  const cases = [
    {
      name: "partial opening before inline code",
      text: "before <coven:res malformed `inline </coven:result>` after",
      visible: "before `inline </coven:result>` after",
    },
    {
      name: "partial closing before inline code",
      text: "before </coven:res malformed `inline <coven:result>` after",
      visible: "before `inline <coven:result>` after",
    },
    {
      name: "partial opening before fenced code",
      text: [
        "before <coven:r malformed",
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        "after",
      ].join("\n"),
      visible: [
        "before ",
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        "after",
      ].join("\n"),
    },
    {
      name: "partial closing before fenced code",
      text: [
        "before </coven:res malformed",
        "```xml",
        "</coven:result>",
        "```",
        "after",
      ].join("\n"),
      visible: ["before ", "```xml", "</coven:result>", "```", "after"].join("\n"),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.deepEqual(extractChatResultMarkers(entry.text), {
        visible: entry.visible,
        results: [],
      });
    });
  }
});

test("unrelated candidates stay visible and do not block later protocol discovery", () => {
  const text = [
    "Keep <coven:random> and </coven:random>.",
    "Drop <coven:res malformed",
    "```xml",
    '<coven:result id="literal" state="passed" label="Literal" />',
    "```",
    `after ${validMarker("after-code", "passed", "After code")} prose`,
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: [
      "Keep <coven:random> and </coven:random>.",
      "Drop ",
      "```xml",
      '<coven:result id="literal" state="passed" label="Literal" />',
      "```",
      "after  prose",
    ].join("\n"),
    results: [
      {
        id: "after-code",
        label: "After code",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("malformed outside candidates cannot consume code and scanning resumes afterward", async (t) => {
  const cases = [
    {
      name: "unclosed opening quote resynchronizes at a clear same-line result",
      text: [
        'before <coven:result id="oops state="passed" ',
        "`inline </coven:result> stays literal`",
        `after ${validMarker("inline-after", "passed", "Inline after")} prose`,
      ].join(""),
      visible: "before  prose",
      resultId: "inline-after",
      resultLabel: "Inline after",
    },
    {
      name: "unterminated opening before fenced closing example",
      text: [
        '<coven:result id="oops" state="passed" label="Oops"',
        "```xml",
        "</coven:result>",
        "```",
        `after ${validMarker("fenced-after", "passed", "Fenced after")} prose`,
      ].join("\n"),
      visible: [
        "```xml",
        "</coven:result>",
        "```",
        "after  prose",
      ].join("\n"),
      resultId: "fenced-after",
      resultLabel: "Fenced after",
    },
    {
      name: "unterminated closing before fenced opening example",
      text: [
        "</coven:result malformed",
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        `after ${validMarker("closer-after", "passed", "Closer after")} prose`,
      ].join("\n"),
      visible: [
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        "after  prose",
      ].join("\n"),
      resultId: "closer-after",
      resultLabel: "Closer after",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.deepEqual(extractChatResultMarkers(entry.text), {
        visible: entry.visible,
        results: entry.resultId === null
          ? []
          : [
            {
              id: entry.resultId,
              label: entry.resultLabel,
              state: "passed",
              source: "familiar",
            },
          ],
      });
    });
  }
});

test("malformed outside openers preserve following Markdown code byte-for-byte", async (t) => {
  const cases = [
    {
      name: "unquoted inline-code range",
      text: "before <coven:result broken= `inline </coven:result> stays literal` after",
      visible: "before `inline </coven:result> stays literal` after",
    },
    {
      name: "backticks inside a quote that never closes are not a fallback boundary",
      text: 'before <coven:result label="oops `inline </coven:result> stays literal` after',
      visible: "before ",
    },
    {
      name: "fenced-code range on the next line after a quote that never closes",
      text: [
        'before <coven:result label="oops',
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        "after",
      ].join("\n"),
      visible: [
        "before ",
        "```xml",
        '<coven:result id="literal" state="passed" label="Literal" />',
        "```",
        "after",
      ].join("\n"),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      assert.deepEqual(extractChatResultMarkers(entry.text), {
        visible: entry.visible,
        results: [],
      });
    });
  }
});

test("an unclosed quoted candidate resynchronizes at a later line-boundary result", () => {
  const first = validMarker("first", "running", "First result");
  const later = validMarker("later", "passed", "Later result");
  const text = [
    `First ${first}`,
    'Before <coven:result id="broken" state="passed" label="never closes',
    later,
    "Ordinary prose survives.",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "First \nBefore \n\nOrdinary prose survives.",
    results: [
      {
        id: "first",
        label: "First result",
        state: "running",
        source: "familiar",
      },
      {
        id: "later",
        label: "Later result",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a line-local unclosed quote does not swallow ordinary prose on later lines", () => {
  const text = [
    'Before <coven:result id="broken" state="passed" label="never closes',
    "Ordinary prose survives.",
    "More prose survives too.",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "Before \nOrdinary prose survives.\nMore prose survives too.",
    results: [],
  });
});

test("an unclosed quote cannot claim a later prose angle terminator", () => {
  const later = validMarker("after-prose", "passed", "After prose");
  const prose = 'Quoted tail " leaves this prose > visible.';
  const text = [
    'Before <coven:result id="broken" state="passed" label="never closes',
    prose,
    later,
    "Trailing prose survives.",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: `Before \n${prose}\n\nTrailing prose survives.`,
    results: [
      {
        id: "after-prose",
        label: "After prose",
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("an unclosed same-line candidate resynchronizes at a clear valid result", () => {
  const later = validMarker("same-line-later", "attention", "Later same-line result");
  const text =
    `before <coven:result id="broken" state="passed" label="never closes ${later} after prose`;

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "before  after prose",
    results: [
      {
        id: "same-line-later",
        label: "Later same-line result",
        state: "attention",
        source: "familiar",
      },
    ],
  });
});

test("complete multiline labels preserve non-result controls and same-line result-like text", () => {
  const label = [
    "Literal controls:",
    "<coven:skill name='literal' stage='done' />",
    "<coven:attention reason='literal' />",
    "```text",
    "<not-a-result>literal</not-a-result>",
    "```",
    "Same-line <coven:result example> stays literal.",
  ].join("\n");
  const marker = [
    "<coven:result",
    '  id="literal-controls"',
    '  state="passed"',
    `  label="${label}"`,
    "/>",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(marker), {
    visible: "",
    results: [
      {
        id: "literal-controls",
        label,
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a valid multiline label owns line-leading result-like text", () => {
  const label = [
    "Literal candidate follows:",
    "<coven:result example>",
    "Literal candidate ends.",
  ].join("\n");
  const marker = [
    "<coven:result",
    '  id="line-leading-literal"',
    '  state="passed"',
    `  label="${label}"`,
    "/>",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(marker), {
    visible: "",
    results: [
      {
        id: "line-leading-literal",
        label,
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a valid multiline label owns line-leading marker-shaped text", () => {
  const label = [
    "Literal marker-shaped text:",
    "<coven:result id='literal' state='failed' label='Not a row' />",
    "Outer label continues.",
  ].join("\n");
  const marker = [
    "<coven:result",
    '  id="marker-shaped-literal"',
    '  state="attention"',
    `  label="${label}"`,
    "/>",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(marker), {
    visible: "",
    results: [
      {
        id: "marker-shaped-literal",
        label,
        state: "attention",
        source: "familiar",
      },
    ],
  });
});

test("inline and fenced code candidates are copied byte-for-byte", () => {
  const text = [
    'Use `<coven:r malformed </coven:result x>` here.',
    "````xml",
    '<coven:result id="fenced" state="passed" label="Fenced" />',
    "</coven:res malformed",
    "````",
  ].join("\r\n");

  assert.deepEqual(extractChatResultMarkers(text), { visible: text, results: [] });
});

test("pending and settled modes hide incomplete protocol identically", () => {
  const text = "Visible <coven:result id=\"build\" state=\"run";
  const expected = { visible: "Visible ", results: [] };

  assert.deepEqual(extractChatResultMarkers(text, { pending: true }), expected);
  assert.deepEqual(extractChatResultMarkers(text, { pending: false }), expected);
  assert.deepEqual(extractChatResultMarkers(text), expected);
});

test("multiline result markers scan through the first unquoted terminator", async (t) => {
  const valid = [
    "<coven:result",
    '  id="multiline"',
    '  state="passed"',
    '  label="Ran `pnpm > test"',
    "/>",
  ].join("\n");
  const malformed = [
    "<coven:result",
    '  id="malformed"',
    '  state="passed"',
    '  label="Malformed"',
    '  note="unexpected"',
    "/>",
  ].join("\n");

  await t.test("valid self-closing marker parses and strips fully", () => {
    assert.deepEqual(extractChatResultMarkers(`before\n${valid}\nafter`), {
      visible: "before\n\nafter",
      results: [
        {
          id: "multiline",
          label: "Ran `pnpm > test",
          state: "passed",
          source: "familiar",
        },
      ],
    });
  });

  await t.test("malformed complete marker strips fully without a row", () => {
    assert.deepEqual(extractChatResultMarkers(`before\n${malformed}\nafter`), {
      visible: "before\n\nafter",
      results: [],
    });
  });

  await t.test("marker inside a fence remains byte-for-byte literal", () => {
    const text = ["```xml", valid, "```"].join("\n");
    assert.deepEqual(extractChatResultMarkers(text), { visible: text, results: [] });
  });
});

test("oversized complete multiline values stay one opaque rejected span", async (t) => {
  const hiddenControls = [
    "```coven:attachment",
    '{ "path": "/workspace/must-not-run.txt" }',
    "```",
    "<thinking>must not run</thinking>",
    '<coven:skill name="must-not-run" stage="done" />',
    '<coven:auto-status state="failed" />',
  ].join("\n");

  for (const oversizedAttribute of ["id", "label"] as const) {
    await t.test(`oversized ${oversizedAttribute}`, () => {
      const oversizedValue = `${"x".repeat(2_048)}\n${hiddenControls}\nexact tail`;
      const marker = [
        "<coven:result",
        oversizedAttribute === "id"
          ? `  id="${oversizedValue}"`
          : '  id="oversized-label"',
        '  state="passed"',
        oversizedAttribute === "label"
          ? `  label="${oversizedValue}"`
          : '  label="Oversized id"',
        "/>",
      ].join("\n");
      const live = validMarker("after-oversized", "passed", "After oversized");
      const text = ["Before.", marker, `After ${live} prose.`].join("\n");
      const scan = scanChatResultProtocol(text);

      assert.equal(
        text.slice(...scan.protectedRanges[0]),
        marker,
        "the cleanup span must include every byte through the unquoted terminator",
      );
      assert.deepEqual(extractChatResultMarkers(text), {
        visible: "Before.\n\nAfter  prose.",
        results: [
          {
            id: "after-oversized",
            label: "After oversized",
            state: "passed",
            source: "familiar",
          },
        ],
      });
    });
  }
});

test("malformed multiline bare attributes strip the end-exclusive terminator", () => {
  const marker = [
    "<coven:result",
    "  id=bare",
    '  state="passed"',
    '  label="Malformed"',
    ">",
  ].join("\n");
  const text = ["Before.", marker, "After."].join("\n");
  const scan = scanChatResultProtocol(text);

  assert.equal(text.slice(...scan.protectedRanges[0]), marker);
  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "Before.\n\nAfter.",
    results: [],
  });
});

test("complete multiline validation failures strip through their terminator", async (t) => {
  const cases = [
    {
      name: "unknown attribute",
      attributes: [
        '  id="unknown"',
        '  state="passed"',
        '  label="Unknown"',
        '  note="not allowed"',
      ],
    },
    {
      name: "duplicate attribute",
      attributes: [
        '  id="duplicate"',
        '  id="duplicate-again"',
        '  state="passed"',
        '  label="Duplicate"',
      ],
    },
    {
      name: "missing attribute",
      attributes: [
        '  id="missing"',
        '  state="passed"',
      ],
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const marker = ["<coven:result", ...entry.attributes, ">"].join("\n");
      const text = ["Before.", marker, "After."].join("\n");
      const scan = scanChatResultProtocol(text);

      assert.equal(text.slice(...scan.protectedRanges[0]), marker);
      assert.deepEqual(extractChatResultMarkers(text), {
        visible: "Before.\n\nAfter.",
        results: [],
      });
    });
  }
});

test("a 100KB complete candidate strips without copying its unbounded attributes", () => {
  const marker = [
    "<coven:result",
    '  id="very-large"',
    '  state="passed"',
    `  label="${"x".repeat(100_000)}`,
    'still part of the oversized label"',
    "/>",
  ].join("\n");
  const text = ["Before.", marker, "After."].join("\n");
  const originalSlice = String.prototype.slice;
  let largestSourceSlice = 0;

  String.prototype.slice = function (start?: number, end?: number): string {
    const source = String(this);
    if (source === text) {
      const from = Math.max(0, start ?? 0);
      const to = Math.min(source.length, end ?? source.length);
      largestSourceSlice = Math.max(largestSourceSlice, Math.max(0, to - from));
    }
    return originalSlice.call(source, start, end);
  };

  const startedAt = performance.now();
  let result: ReturnType<typeof extractChatResultMarkers>;
  let scan: ReturnType<typeof scanChatResultProtocol>;
  try {
    scan = scanChatResultProtocol(text);
    result = extractChatResultMarkers(text);
  } finally {
    String.prototype.slice = originalSlice;
  }
  const elapsedMs = performance.now() - startedAt;

  assert.equal(text.slice(...scan.protectedRanges[0]), marker);
  assert.deepEqual(result, {
    visible: "Before.\n\nAfter.",
    results: [],
  });
  assert.ok(
    largestSourceSlice < 4_096,
    `cleanup copied a ${largestSourceSlice}-byte source slice`,
  );
  assert.ok(
    elapsedMs < 4_000,
    `100KB complete candidate took ${elapsedMs.toFixed(1)}ms`,
  );
});

test("a multiline fence-looking label stays protocol-owned and preserves its exact bytes", () => {
  const label = ["Ran `pnpm test`", "```", "kept lone ` tail"].join("\n");
  const marker = [
    "<coven:result",
    '  id="fence-label"',
    '  state="passed"',
    `  label="${label}"`,
    "/>",
  ].join("\n");
  const text = `before\n${marker}\nafter`;
  const masked = maskChatResultProtocolForMarkdown(text);
  const markerStart = text.indexOf(marker);

  assert.equal(masked.length, text.length);
  assert.deepEqual(
    [...masked.matchAll(/\n/g)].map((match) => match.index),
    [...text.matchAll(/\n/g)].map((match) => match.index),
  );
  assert.doesNotMatch(
    masked.slice(markerStart, markerStart + marker.length),
    /`/,
    "only the range source should neutralize protocol-owned Markdown delimiters",
  );
  assert.deepEqual(extractChatResultMarkers(text), {
    visible: "before\n\nafter",
    results: [
      {
        id: "fence-label",
        label,
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a multiline tilde-fence label is inert in the range source and remains exact", () => {
  const label = ["Ran checks", "~~~", "still exact"].join("\n");
  const marker = [
    "<coven:result",
    '  id="tilde-label"',
    '  state="passed"',
    `  label="${label}"`,
    "/>",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(`before\n${marker}\nafter`), {
    visible: "before\n\nafter",
    results: [
      {
        id: "tilde-label",
        label,
        state: "passed",
        source: "familiar",
      },
    ],
  });
});

test("a malformed multiline fence-looking marker strips fully and scanning resumes", () => {
  const malformed = [
    "<coven:result",
    '  id="malformed"',
    '  state="unknown"',
    '  label="Malformed',
    "```",
    'label ` bytes"',
    '  note="unexpected"',
    "/>",
  ].join("\n");
  const live = validMarker("live", "passed", "Live result");

  assert.deepEqual(
    extractChatResultMarkers(`before\n${malformed}\nafter ${live} prose`),
    {
      visible: "before\n\nafter  prose",
      results: [
        {
          id: "live",
          label: "Live result",
          state: "passed",
          source: "familiar",
        },
      ],
    },
  );
});

test("an incomplete result opener preserves the real fence that follows it", () => {
  const literal = validMarker("literal", "failed", "Literal");
  const text = [
    'before <coven:result id="broken" state="passed" label="Ran `pnpm test',
    "```xml",
    literal,
    "```",
    "after",
  ].join("\n");

  assert.deepEqual(extractChatResultMarkers(text), {
    visible: ["before ", "```xml", literal, "```", "after"].join("\n"),
    results: [],
  });
});

test("result protocol masking is length-preserving and leaves outer code delimiters intact", () => {
  const marker = validMarker("tests", "passed", "Ran `pnpm test");
  const text = `Use \`${marker}\` literally.\n${marker}`;
  const masked = maskChatResultProtocolForMarkdown(text);
  const outerOpen = text.indexOf("`");
  const outerClose = text.indexOf("`", outerOpen + 1 + marker.length);

  assert.equal(masked.length, text.length);
  assert.deepEqual(
    [...masked.matchAll(/\n/g)].map((match) => match.index),
    [...text.matchAll(/\n/g)].map((match) => match.index),
  );
  assert.equal(masked[outerOpen], "`");
  assert.equal(masked[outerClose], "`");
  assert.equal(masked.match(/`/g)?.length, 2);

  const malformed =
    "<coven:result id='tests' state='passed' label='Ran `pnpm test' />";
  assert.doesNotMatch(maskChatResultProtocolForMarkdown(malformed), /`/);

  const incompleteInline =
    'Use ``<coven:result label="Ran `pnpm test`` literally.';
  const maskedInline = maskChatResultProtocolForMarkdown(incompleteInline);
  assert.equal(maskedInline.match(/`/g)?.length, 4);
  assert.equal(maskedInline[incompleteInline.indexOf("`pnpm")], " ");
  assert.deepEqual(extractChatResultMarkers(incompleteInline), {
    visible: incompleteInline,
    results: [],
  });
});

test("result protocol scans expose bounded original offsets but exclude Markdown code", () => {
  const valid = validMarker(
    "valid",
    "passed",
    "Literal <thinking>not live</thinking> and `code`",
  );
  const malformed = [
    "<coven:result",
    "  id='malformed'",
    '  label="Literal <coven:skill />"',
    "/>",
  ].join("\n");
  const inline = `\`${validMarker(
    "inline",
    "failed",
    "Literal <thinking>inline</thinking>",
  )}\``;
  const fenced = [
    "```xml",
    validMarker("fenced", "failed", "Literal <thinking>fenced</thinking>"),
    "```",
  ].join("\n");
  const partial = [
    "<coven:result",
    '  id="partial"',
    '  label="still open',
  ].join("\n");
  const text = [valid, malformed, inline, fenced, partial].join("\n");

  const scan = scanChatResultProtocol(text);
  const ranges = chatResultProtocolRanges(text);
  assert.equal(scan.markdownRangeSource.length, text.length);
  assert.deepEqual(scan.protectedRanges, ranges);
  assert.deepEqual(
    ranges.map(([start, end]) => text.slice(start, end)),
    [valid, malformed, partial],
  );
  assert.deepEqual(
    ranges,
    ranges.toSorted(([left], [right]) => left - right),
    "protocol ranges must be sorted",
  );
  for (let index = 0; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    assert.ok(start >= 0 && start < end && end <= text.length);
    if (index > 0) assert.ok(ranges[index - 1][1] <= start);
  }
  assert.deepEqual(
    scanChatResultProtocol(text),
    scan,
    "the lexical scan must be deterministic",
  );
});

function benchmarkResultMarkers(count: number): number {
  const text = Array.from({ length: count }, (_, index) =>
    validMarker(
      `result-${index}`,
      "passed",
      index % 2 === 0 ? "`pnpm test` passed" : "Ran `pnpm test",
    )
  ).join("\n");
  const startedAt = performance.now();
  const result = extractChatResultMarkers(text);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.results.length, count);
  return elapsedMs;
}

test("extracting 400/800 backtick-bearing result markers stays within a linear-time budget", () => {
  benchmarkResultMarkers(20);
  const elapsed400 = benchmarkResultMarkers(400);
  const elapsed800 = benchmarkResultMarkers(800);

  assert.ok(
    elapsed400 < 4_000,
    `400 result markers took ${elapsed400.toFixed(1)}ms (expected < 4000ms)`,
  );
  assert.ok(
    elapsed800 < 8_000,
    `800 result markers took ${elapsed800.toFixed(1)}ms (expected < 8000ms)`,
  );
  assert.ok(
    elapsed800 < Math.max(200, elapsed400 * 4),
    `400→800 scaling was ${elapsed400.toFixed(1)}ms→${elapsed800.toFixed(1)}ms`,
  );
});

function benchmarkUnclosedQuoteRecovery(count: number): number {
  const text = Array.from({ length: count }, (_, index) => [
    `<coven:result id="broken-${index}" state="passed" label="never closes`,
    validMarker(`recovered-${index}`, "passed", `Recovered ${index}`),
    `Prose ${index}.`,
  ].join("\n")).join("\n");
  const startedAt = performance.now();
  const result = extractChatResultMarkers(text);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.results.length, count);
  assert.deepEqual(
    result.results.map(({ id }) => id),
    Array.from({ length: count }, (_, index) => `recovered-${index}`),
  );
  assert.match(result.visible, /Prose 0\./);
  assert.match(result.visible, new RegExp(`Prose ${count - 1}\\.`));
  assert.doesNotMatch(result.visible, /coven:result|never closes/);
  return elapsedMs;
}

test("400/800 unclosed-quote recoveries stay within a linear-time budget", () => {
  benchmarkUnclosedQuoteRecovery(20);
  const elapsed400 = benchmarkUnclosedQuoteRecovery(400);
  const elapsed800 = benchmarkUnclosedQuoteRecovery(800);

  assert.ok(
    elapsed400 < 4_000,
    `400 malformed recoveries took ${elapsed400.toFixed(1)}ms (expected < 4000ms)`,
  );
  assert.ok(
    elapsed800 < 8_000,
    `800 malformed recoveries took ${elapsed800.toFixed(1)}ms (expected < 8000ms)`,
  );
  assert.ok(
    elapsed800 < Math.max(250, elapsed400 * 4),
    `400→800 malformed scaling was ${elapsed400.toFixed(1)}ms→${elapsed800.toFixed(1)}ms`,
  );
});

function malformedSameLineCandidates(count: number): string {
  const payload = "x".repeat(256);
  return Array.from({ length: count }, () => `<coven:r ${payload}`).join(" ");
}

function scanMalformedCandidates(text: string): {
  elapsedMs: number;
  newlineBytesVisited: number;
} {
  const originalIndexOf = String.prototype.indexOf;
  const originalLastIndexOf = String.prototype.lastIndexOf;
  let newlineBytesVisited = 0;

  String.prototype.indexOf = function (
    searchString: string,
    position?: number,
  ): number {
    const source = String(this);
    const result = originalIndexOf.call(source, searchString, position);
    if (source === text && searchString === "\n") {
      const from = Math.max(0, position ?? 0);
      const end = result === -1 ? source.length : result + 1;
      newlineBytesVisited += Math.max(0, end - from);
    }
    return result;
  };
  String.prototype.lastIndexOf = function (
    searchString: string,
    position?: number,
  ): number {
    const source = String(this);
    const result = originalLastIndexOf.call(source, searchString, position);
    if (source === text && searchString === "\n") {
      const from = Math.min(source.length - 1, position ?? source.length - 1);
      newlineBytesVisited += result === -1
        ? Math.max(0, from + 1)
        : Math.max(0, from - result + 1);
    }
    return result;
  };

  const startedAt = performance.now();
  try {
    const result = extractChatResultMarkers(text);
    assert.deepEqual(result, { visible: "", results: [] });
  } finally {
    String.prototype.indexOf = originalIndexOf;
    String.prototype.lastIndexOf = originalLastIndexOf;
  }
  return {
    elapsedMs: performance.now() - startedAt,
    newlineBytesVisited,
  };
}

test("400/800 malformed same-line candidates scale near-linearly", (t) => {
  const text400 = malformedSameLineCandidates(400);
  const text800 = malformedSameLineCandidates(800);
  scanMalformedCandidates(malformedSameLineCandidates(20));
  const scan400 = scanMalformedCandidates(text400);
  const scan800 = scanMalformedCandidates(text800);
  const ratio = scan800.elapsedMs / scan400.elapsedMs;

  t.diagnostic(
    `malformed same-line: 400=${scan400.elapsedMs.toFixed(2)}ms/`
      + `${scan400.newlineBytesVisited} newline bytes, `
      + `800=${scan800.elapsedMs.toFixed(2)}ms/`
      + `${scan800.newlineBytesVisited} newline bytes, ratio=${ratio.toFixed(2)}x`,
  );
  assert.ok(
    scan400.newlineBytesVisited <= text400.length * 8,
    `400 candidates revisited ${scan400.newlineBytesVisited} newline-search bytes `
      + `for ${text400.length} source bytes`,
  );
  assert.ok(
    scan800.newlineBytesVisited <= text800.length * 8,
    `800 candidates revisited ${scan800.newlineBytesVisited} newline-search bytes `
      + `for ${text800.length} source bytes`,
  );
});
