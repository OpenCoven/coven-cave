import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_APPROVE_OPTIONS,
  MAX_APPROVE_QUESTIONS,
  MIN_APPROVE_OPTIONS,
  approveRequestKey,
  approveQuestionIsSafe,
  formatApproveAnswers,
  parseApproveOptions,
  protectApproveMarkers,
  sanitizeApproveMarkers,
  sliceApproveBlocks,
  stripApproveMarkers,
  stripIncompleteApproveMarker,
  type ApproveTextPiece,
} from "./approve-blocks.ts";

const q = (prompt: string, options = "x|y", extra = "") =>
  `<coven:approve kind="questions" prompt="${prompt}" options="${options}"${extra ? ` ${extra}` : ""} />`;
const approves = (pieces: ApproveTextPiece[]) => pieces.filter((piece) => piece.kind === "approve");
const texts = (pieces: ApproveTextPiece[]) =>
  pieces.filter((piece) => piece.kind === "text").map((piece) => piece.text);
const questions = (text: string) =>
  approves(sliceApproveBlocks(text)).flatMap(({ request }) => request.questions);

// Recovered behavior from 107e94de4989c1aceb866ef55234bd85e2a2817c.
test("extracts a single question with its options", () => {
  const pieces = sliceApproveBlocks(`Before ${q("Which auth?", "Cookies|JWT")} after`);
  const cards = approves(pieces);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].request.kind, "questions");
  assert.deepEqual(cards[0].request.questions[0].options, ["Cookies", "JWT"]);
  assert.equal(cards[0].request.questions[0].prompt, "Which auth?");
  assert.deepEqual(texts(pieces), ["Before ", " after"]);
});

test("text with no marker round-trips unchanged as a single piece", () => {
  assert.deepEqual(sliceApproveBlocks("just prose"), [{ kind: "text", text: "just prose" }]);
  assert.deepEqual(sliceApproveBlocks(""), [{ kind: "text", text: "" }]);
});

test("positional ids stay unique across a span; explicit id wins", () => {
  const text = `${q("A")} sep ${q("B", "x|y", 'id="picked"')} sep ${q("C")}`;
  assert.deepEqual(questions(text).map(({ id }) => id), ["q1", "picked", "q3"]);
});

test("whitespace-adjacent markers collapse into one card", () => {
  const pieces = sliceApproveBlocks(`${q("A")}\n${q("B")}`);
  assert.equal(approves(pieces).length, 1);
  assert.deepEqual(questions(`${q("A")}\n${q("B")}`).map(({ prompt }) => prompt), ["A", "B"]);
  assert.deepEqual(texts(pieces), []);
});

test("prose between markers opens a separate card", () => {
  const pieces = sliceApproveBlocks(`${q("A")} and also ${q("B")}`);
  assert.equal(approves(pieces).length, 2);
  assert.deepEqual(texts(pieces), [" and also "]);
});

test("overflow past the cap opens a NEW card rather than dropping a question", () => {
  const text = [1, 2, 3, 4, 5].map((n) => q(`Q${n}`)).join("\n");
  const cards = approves(sliceApproveBlocks(text));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].request.questions.length, MAX_APPROVE_QUESTIONS);
  assert.equal(cards[1].request.questions.length, 2);
  assert.deepEqual(questions(text).map(({ prompt }) => prompt), ["Q1", "Q2", "Q3", "Q4", "Q5"]);
});

test("a rejected marker between two valid ones breaks the run", () => {
  for (const invalid of [q("B", "only"), '<coven:approve kind=busted>']) {
    const cards = approves(sliceApproveBlocks(`${q("A")}\n${invalid}\n${q("C")}`));
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map(({ request }) => request.questions.map(({ prompt }) => prompt)), [["A"], ["C"]]);
  }
});

test("options are trimmed, de-duplicated, and capped", () => {
  assert.deepEqual(parseApproveOptions("  a |a| b  |"), ["a", "b"]);
  assert.equal(parseApproveOptions("a|b|c|d|e|f|g|h").length, MAX_APPROVE_OPTIONS);
  assert.deepEqual(parseApproveOptions(undefined), []);
});

test("a question below the option minimum is dropped entirely", () => {
  assert.equal(MIN_APPROVE_OPTIONS, 2);
  const pieces = sliceApproveBlocks(`x ${q("A", "solo")} y`);
  assert.equal(approves(pieces).length, 0);
  assert.equal(texts(pieces).join(""), "x  y");
});

test("duplicate options that collapse below the minimum drop the question", () => {
  assert.equal(questions(q("A", "same|same")).length, 0);
});

test("free text is offered by default and opts out explicitly", () => {
  assert.equal(questions(q("A"))[0].allowOther, true);
  for (const other of ["no", "false", "NO"]) {
    assert.equal(questions(q("A", "x|y", `other="${other}"`))[0].allowOther, false);
  }
  assert.equal(questions(q("A", "x|y", 'other="maybe"'))[0].allowOther, true);
});

test("credential-seeking prompts and options are rejected", () => {
  for (const text of [
    q("Paste your API key", "Ready|Cancel"),
    q("Paste your token", "Ready|Cancel"),
    q("Choose a path", "Use cookies|Enter password"),
    q("Share the client secret for this service", "Yes|No"),
  ]) {
    assert.equal(questions(text).length, 0, text);
    assert.equal(sanitizeApproveMarkers(text), "", text);
  }
  assert.equal(questions(q("Which auth?", "Cookies|JWT")).length, 1);
});

test("answer formatting refuses unsafe question descriptors", () => {
  const request = {
    kind: "questions" as const,
    questions: [
      { id: "safe", prompt: "Which auth?", options: ["Cookies", "JWT"], allowOther: true },
      { id: "secret", prompt: "Paste your API key", options: ["Ready", "Cancel"], allowOther: true },
    ],
  };
  assert.equal(approveQuestionIsSafe(request.questions[0]), true);
  assert.equal(approveQuestionIsSafe(request.questions[1]), false);
  assert.equal(formatApproveAnswers(request, { safe: "JWT", secret: "abc123" }), "Which auth? → JWT");
});

test("an unknown kind is dropped, never downgraded to questions", () => {
  for (const kind of ["command", "plan", "credentials", "unknown"]) {
    const text = `<coven:approve kind="${kind}" prompt="Run it?" options="Yes|No" />`;
    assert.equal(questions(text).length, 0);
    assert.equal(stripApproveMarkers(text), "");
    assert.equal(sanitizeApproveMarkers(text), "");
  }
});

test("a missing kind is dropped", () => {
  assert.equal(questions('<coven:approve prompt="A" options="x|y" />').length, 0);
});

test("a duplicate attribute fails closed and drops the marker", () => {
  const text = '<coven:approve kind="questions" prompt="A" prompt="B" options="x|y" />';
  assert.equal(questions(text).length, 0);
  assert.equal(texts(sliceApproveBlocks(text)).join(""), "");
});

test("a malformed marker is removed without leaking a raw tag or eating prose", () => {
  const pieces = sliceApproveBlocks('start <coven:approve kind=questions> tail');
  assert.equal(approves(pieces).length, 0);
  assert.equal(texts(pieces).join(""), "start  tail");
});

test("a malformed marker does not hide a later valid one", () => {
  const text = `<coven:approve" busted> ${q("A")}`;
  assert.deepEqual(questions(text).map(({ prompt }) => prompt), ["A"]);
});

test("a closing tag is stripped (the protocol is self-closing)", () => {
  const pieces = sliceApproveBlocks(`${q("A")}</coven:approve>`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join(""), "");
  assert.equal(stripApproveMarkers("</coven:approve>"), "");
  assert.equal(stripApproveMarkers("before </coven:approve"), "before ");
});

test("attention markers survive every approve path untouched", () => {
  const attention = '<coven:attention reason="needs a human" />';
  const pieces = sliceApproveBlocks(`${attention} then ${q("A")}`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join(""), `${attention} then `);
  assert.equal(stripApproveMarkers(attention), attention);
  assert.equal(stripIncompleteApproveMarker(attention), attention);
  assert.equal(sanitizeApproveMarkers(attention), attention);
});

test("an incomplete attention tail is left for its own parser", () => {
  const tail = 'text <coven:attention reason="hal';
  assert.equal(stripIncompleteApproveMarker(tail), tail);
  assert.equal(stripApproveMarkers(tail), tail);
});

test("an incomplete approve tail is hidden while streaming", () => {
  assert.equal(stripIncompleteApproveMarker('text <coven:approve kind="ques'), "text ");
  assert.equal(stripIncompleteApproveMarker("text <coven:app"), "text ");
});

test("a complete marker survives stripIncomplete but not stripApproveMarkers", () => {
  const text = `a ${q("A")} b`;
  assert.equal(stripIncompleteApproveMarker(text), text);
  assert.equal(stripApproveMarkers(text), "a  b");
});

test("the settled slicer also hides an incomplete tail", () => {
  const pieces = sliceApproveBlocks(`${q("A")} then <coven:approve kind="que`);
  assert.equal(approves(pieces).length, 1);
  assert.equal(texts(pieces).join(""), " then ");
});

test("a fenced marker stays literal example text", () => {
  const text = ["Use it like:", "```", q("A"), "```"].join("\n");
  assert.deepEqual(sliceApproveBlocks(text), [{ kind: "text", text }]);
});

test("inline code keeps a marker literal", () => {
  const text = `write \`${q("A")}\` to ask`;
  assert.deepEqual(sliceApproveBlocks(text), [{ kind: "text", text }]);
  assert.equal(stripApproveMarkers(text), text);
});

test("a malformed marker before a fence does not consume the fence", () => {
  const example = ["```", q("A"), "```"].join("\n");
  const text = `<coven:approve kind=busted\n${example}`;
  assert.deepEqual(sliceApproveBlocks(text), [{ kind: "text", text: `\n${example}` }]);
});

test("stripApproveMarkers leaves fenced examples alone", () => {
  const text = ["```", q("A"), "```"].join("\n");
  assert.equal(stripApproveMarkers(text), text);
});

test("a > inside a prompt does not close the tag early", () => {
  const pieces = sliceApproveBlocks(q("Use a > b?", "Yes|No"));
  assert.equal(approves(pieces)[0].request.questions[0].prompt, "Use a > b?");
  assert.equal(texts(pieces).join(""), "");
});

test("an empty prompt drops the question", () => {
  assert.equal(questions(q("   ")).length, 0);
});

test("answers format one line per question and omit the unanswered", () => {
  const request = approves(sliceApproveBlocks(`${q("A")}\n${q("B", "p|r")}`))[0].request;
  assert.equal(formatApproveAnswers(request, { q1: "x" }), "A → x");
  assert.equal(formatApproveAnswers(request, { q1: "x", q2: "r" }), "A → x\nB → r");
  assert.equal(formatApproveAnswers(request, {}), "");
  assert.equal(formatApproveAnswers(request, { q1: "   " }), "");
  assert.equal(formatApproveAnswers(request, { q2: "  my alternative  " }), "B → my alternative");
});

test("the card key distinguishes different question sets", () => {
  const a = approves(sliceApproveBlocks(q("A")))[0].request;
  const b = approves(sliceApproveBlocks(q("B")))[0].request;
  assert.notEqual(approveRequestKey(a), approveRequestKey(b));
  assert.equal(typeof approveRequestKey(a), "string");
});

test("duplicate explicit ids cannot alias answers in a card or across overflow", () => {
  const text = [1, 2, 3, 4].map((n) => q(`Q${n}`, "x|y", 'id="same"')).join("\n");
  const cards = approves(sliceApproveBlocks(text));
  const ids = questions(text).map(({ id }) => id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids[0], "same");
  assert.deepEqual(questions(text).map(({ id }) => id), ids);
  assert.equal(formatApproveAnswers(cards[0].request, { [ids[0]]: "x" }), "Q1 → x");
  assert.equal(formatApproveAnswers(cards[1].request, { [ids[0]]: "x" }), "");
});

test("fallback and suffixed ids cannot displace ordinary explicit ids", () => {
  const text = [
    q("Fallback"),
    q("Explicit", "x|y", 'id="q1"'),
    q("Duplicate", "x|y", 'id="q1"'),
    q("Suffix already explicit", "x|y", 'id="q1#2"'),
  ].join("\n");
  const ids = questions(text).map(({ id }) => id);
  assert.equal(ids[1], "q1");
  assert.equal(ids[3], "q1#2");
  assert.equal(new Set(ids).size, ids.length);
});

test("card keys change with options, option order and Other policy", () => {
  const keys = [
    q("A", "x|y", 'id="q"'),
    q("A", "x|z", 'id="q"'),
    q("A", "y|x", 'id="q"'),
    q("A", "x|y", 'id="q" other="no"'),
  ].map((text) => approveRequestKey(approves(sliceApproveBlocks(text))[0].request));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys[0], approveRequestKey(approves(sliceApproveBlocks(q("A", "x|y", 'id="q"')))[0].request));
});

test("unknown attributes fail closed rather than weakening a privileged variant", () => {
  for (const attr of ['command="rm"', 'plan="Deploy"', 'credential="token"', 'type="password"', 'auto-send="yes"', 'unknown="yes"']) {
    const text = q("A", "x|y", attr);
    assert.equal(questions(text).length, 0, attr);
    assert.equal(sanitizeApproveMarkers(text), "", attr);
  }
});

test("unclosed quotes never swallow later valid markers or sibling protocol", () => {
  const attention = '<coven:attention reason="decision" />';
  for (const broken of [
    '<coven:approve kind="questions" prompt="broken',
    '<coven:approve kind="questions" prompt="broken>',
    '<coven:approve kind="questions" prompt="broken />',
    '<coven:approve" busted',
    '</coven:approve',
  ]) {
    for (const separator of ["", " ", "\n"]) {
      const text = `${broken}${separator}${attention}${q("Later")}`;
      assert.deepEqual(questions(text).map(({ prompt }) => prompt), ["Later"], text);
      assert.ok(stripApproveMarkers(text).includes(attention), text);
      assert.doesNotMatch(stripApproveMarkers(text), /coven:approve/, text);
    }
  }
});

test("malformed recovery preserves prose and code on the next line", () => {
  const example = `\`${q("Example")}\``;
  for (const next of ["Visible prose.", example, `~~~xml\n${q("Example")}\n~~~`]) {
    const text = `<coven:approve kind="questions" prompt="unfinished\n${next}`;
    assert.equal(stripApproveMarkers(text), `\n${next}`);
    assert.equal(sanitizeApproveMarkers(text), `\n${next}`);
  }
});

test("an unclosed quote does not promote a following inline example to a live card", () => {
  const example = `\`${q("Example")}\``;
  const text = `<coven:approve prompt="unfinished ${example}`;
  assert.equal(stripApproveMarkers(text), example);
  assert.equal(sanitizeApproveMarkers(text), example);
  assert.deepEqual(sliceApproveBlocks(text), [{ kind: "text", text: example }]);
});

test("a backtick inside a broken attribute cannot hide a later live marker", () => {
  const attention = '<coven:attention reason="decision" />';
  const text = `<coven:approve prompt="unfinished \`${attention}${q("Live `?")}`;
  assert.equal(stripApproveMarkers(text), attention);
  assert.deepEqual(questions(text).map(({ prompt }) => prompt), ["Live `?"]);
});

test("incomplete multiline attributes stay hidden", () => {
  const text = 'Before <coven:approve\n kind="questions"\n prompt="Which?"\n options="A|';
  assert.equal(stripApproveMarkers(text), "Before ");
  assert.equal(sanitizeApproveMarkers(text), "Before ");
});

test("marker attribute backticks do not turn later markers into literal code", () => {
  const text = `${q("Use `cookies`?")}\n${q("Use `")}\n${q("Later?")}`;
  assert.equal(questions(text).length, 3);
  assert.equal(stripApproveMarkers(text), "\n\n");
});

test("list and quote fences preserve literal examples", () => {
  for (const text of [
    `- \`\`\`xml\n  ${q("Example")}\n  \`\`\``,
    `> \`\`\`xml\n> ${q("Example")}\n> \`\`\``,
    `\`\`\`\`xml\n${q("Example")}\n\`\`\`\``,
  ]) {
    assert.deepEqual(sliceApproveBlocks(text), [{ kind: "text", text }]);
    assert.equal(sanitizeApproveMarkers(text), text);
  }
});

test("clean card text retains only valid live markers and literal examples", () => {
  const literal = `\`${q("Example", "x|y", 'unknown="yes"')}\``;
  const text = `${q("Valid")} ${q("Invalid", "x|y", 'command="yes"')} ${literal} <coven:app`;
  assert.equal(sanitizeApproveMarkers(text), `${q("Valid")}  ${literal} `);
});

test("answer formatting ignores inherited properties, including protocol-chosen ids", () => {
  const request = approves(sliceApproveBlocks(q("A", "x|y", 'id="toString"')))[0].request;
  const id = request.questions[0].id;
  assert.equal(formatApproveAnswers(request, {}), "");
  assert.equal(formatApproveAnswers(request, Object.create({ [id]: "not chosen" })), "");
  assert.equal(formatApproveAnswers(request, { [id]: "x" }), "A → x");
});

test("prototype-like authored ids are safe keys for plain object answer state", () => {
  for (const authoredId of Object.getOwnPropertyNames(Object.prototype)) {
    const text = [
      q("A", "x|y", `id="${authoredId}"`),
      q("B", "x|y", `id="${authoredId}"`),
      q("Ordinary explicit suffix", "x|y", `id="${authoredId}#2"`),
    ].join("\n");
    const request = approves(sliceApproveBlocks(text))[0].request;
    const ids = request.questions.map(({ id }) => id);
    const answers: Record<string, string> = {};
    assert.equal(ids[2], `${authoredId}#2`);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(questions(text).map(({ id }) => id), ids);
    for (const id of ids) {
      assert.equal(answers[id], undefined, `${authoredId} must not read inherited state`);
      assert.equal(Object.hasOwn(Object.prototype, id), false);
    }
    assert.equal(formatApproveAnswers(request, answers), "");
    answers[ids[0]] = "x";
    answers[ids[1]] = "y";
    assert.equal(Object.getPrototypeOf(answers), Object.prototype);
    assert.equal(formatApproveAnswers(request, answers), "A → x\nB → y");
  }
});

test("opaque marker protection round-trips without replacing author text", () => {
  const text = `\uE000coven-questions:0\uE001 ${q("Use `?")} \`${q("Example")}\``;
  const protectedText = protectApproveMarkers(text);
  assert.equal(protectedText.restore(protectedText.text, true), text);
  assert.equal(protectedText.restore(protectedText.text, false), stripApproveMarkers(text));
});
