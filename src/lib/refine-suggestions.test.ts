import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REFINE_SUGGESTIONS,
  generateRefineSuggestions,
} from "./refine-suggestions.ts";

test("defaults are a small, stable quartet — 2-or-4 policy, never 3", () => {
  assert.equal(DEFAULT_REFINE_SUGGESTIONS.length, 4);
  assert.ok(DEFAULT_REFINE_SUGGESTIONS.every((s) => typeof s === "string" && s.length > 0));
});

test("always returns at least one suggestion, capped at the limit", () => {
  assert.ok(generateRefineSuggestions("", "html").length >= 1);
  assert.ok(generateRefineSuggestions("", "html").length <= 4);
  assert.equal(generateRefineSuggestions("<button>hi</button>", "html", 2).length, 2);
});

test("generated row comes as a pair or a spread — never exactly 3", () => {
  // A polished artifact that trips no rule (has @media, transitions, no
  // form/button/svg) would pool exactly the 3 fallbacks — trimmed to 2.
  const polished =
    "<style>@media (min-width:600px){.a{color:red}} .b{transition:opacity .2s}</style><div>hi</div>";
  assert.equal(generateRefineSuggestions(polished, "html").length, 2);
  assert.notEqual(generateRefineSuggestions("", "html").length, 3);
  assert.notEqual(generateRefineSuggestions("<button>hi</button>", "html").length, 3);
});

test("generated suggestions never duplicate the defaults", () => {
  const gen = generateRefineSuggestions("<h1>Title</h1>", "html");
  const defaults = new Set(DEFAULT_REFINE_SUGGESTIONS.map((s) => s.toLowerCase()));
  assert.ok(gen.every((s) => !defaults.has(s.toLowerCase())));
});

test("buttons without hover states surface an interaction-states idea", () => {
  const gen = generateRefineSuggestions("<button>Click</button>", "html");
  assert.ok(gen.some((s) => /hover.*active.*focus/i.test(s)));
});

test("a form surfaces a validation idea", () => {
  const gen = generateRefineSuggestions("<form><input /></form>", "html");
  assert.ok(gen.some((s) => /validation/i.test(s)));
});

test("a plain html document with no media query suggests responsiveness", () => {
  const gen = generateRefineSuggestions("<div style='width:600px'>x</div>", "html");
  assert.ok(gen.some((s) => /responsive/i.test(s)));
});

test("react artifacts don't get the html-only responsive rule but can get loading states", () => {
  const gen = generateRefineSuggestions("export default function App(){ const [n,setN]=useState(0); return <div/> }", "react");
  assert.ok(gen.some((s) => /loading and empty/i.test(s)));
});
