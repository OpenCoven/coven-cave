// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./onboarding-overlay.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /max-w-\[min\(1680px,100vw\)\]/,
  "Setup should use the full available viewport width instead of a narrow centered column",
);

assert.match(
  source,
  /lg:grid-cols-12/,
  "Setup should use a responsive twelve-column bento grid",
);

assert.match(
  source,
  /auto-rows-\[minmax\(0,auto\)\]/,
  "Setup bento cards should flow dynamically without fixed vertical dead space",
);

assert.match(
  source,
  /const BENTO_CARD =/,
  "Setup card styling should be centralized so spacing stays consistent",
);

assert.match(
  source,
  /xl:col-span-4[\s\S]*Install path/,
  "Install instructions should occupy a balanced bento card rather than a whole side column",
);

assert.match(
  source,
  /xl:col-span-4[\s\S]*Available harnesses/,
  "Local harnesses should occupy a peer bento card in the same grid",
);

assert.match(
  source,
  /xl:col-span-4[\s\S]*Existing OpenClaw agents/,
  "OpenClaw agents should occupy a peer bento card in the same grid",
);

assert.match(
  source,
  /Codex[\s\S]*Claude Code[\s\S]*Hermes[\s\S]*OpenClaw/,
  "Setup copy should present Codex, Claude Code, Hermes, and OpenClaw as peer ways to create a first familiar",
);

assert.match(
  source,
  /xl:col-span-8[\s\S]*Familiar details/,
  "The familiar form should span wider than chooser cards for comfortable editing",
);
