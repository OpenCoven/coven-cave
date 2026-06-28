// Unit tests for the LLM-judge prompt builder + verdict parser.
import assert from "node:assert/strict";
import { buildJudgePrompt, parseJudgeVerdict, judgeRubric } from "./eval-judge.ts";

// ---- buildJudgePrompt ----
{
  const p = buildJudgePrompt("Be polite", "say hi", "Hello there!");
  assert.match(p, /RUBRIC:\nBe polite/, "prompt embeds the rubric");
  assert.match(p, /say hi/, "prompt embeds the input");
  assert.match(p, /Hello there!/, "prompt embeds the response");
  assert.match(p, /JSON object/, "prompt asks for JSON");
}

// ---- parseJudgeVerdict: JSON ----
{
  const v = parseJudgeVerdict('{"score": 0.9, "pass": true, "reason": "great"}');
  assert.equal(v.score, 0.9);
  assert.equal(v.pass, true);
  assert.equal(v.reason, "great");

  const fenced = parseJudgeVerdict('```json\n{"score":0.2,"pass":false,"reason":"weak"}\n```');
  assert.equal(fenced.score, 0.2);
  assert.equal(fenced.pass, false);

  const embedded = parseJudgeVerdict('Sure — {"score": 1, "pass": true} done');
  assert.equal(embedded.score, 1);
  assert.equal(embedded.pass, true);
}

// ---- parseJudgeVerdict: pass derived from score when no explicit pass ----
{
  assert.equal(parseJudgeVerdict('{"score": 0.6}').pass, true, "score>=0.5 derives pass");
  assert.equal(parseJudgeVerdict('{"score": 0.4}').pass, false, "score<0.5 derives fail");
}

// ---- parseJudgeVerdict: numeric fallbacks ----
{
  assert.equal(parseJudgeVerdict("Score: 8/10").score, 0.8, "fraction parses");
  assert.equal(parseJudgeVerdict("I'd give it 85%").score, 0.85, "percent parses");
  assert.equal(parseJudgeVerdict("score = 7").score, 0.7, "0..10 scale normalizes");
}

// ---- parseJudgeVerdict: keyword + default ----
{
  assert.equal(parseJudgeVerdict("PASS — looks good").pass, true, "bare PASS");
  assert.equal(parseJudgeVerdict("This fails the rubric").pass, false, "bare FAIL");
  const dflt = parseJudgeVerdict("hmm not sure");
  assert.equal(dflt.pass, false, "unparseable defaults to fail");
  assert.equal(dflt.score, 0, "unparseable scores 0");
}

// ---- judgeRubric ----
{
  assert.equal(judgeRubric({ kind: "llm_judge", value: "", rubric: "be kind" }), "be kind");
  assert.equal(judgeRubric({ kind: "llm_judge", value: "fallback" }), "fallback", "falls back to value");
}

console.log("eval-judge.test.ts OK");
