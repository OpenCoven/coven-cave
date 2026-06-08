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

assert.doesNotMatch(
  source,
  /setSelectedAgentId\(\(current\) => \{[\s\S]*agents\[0\]/,
  "Setup should not auto-select the first OpenClaw agent",
);

assert.doesNotMatch(
  source,
  /next\.find\(\(adapter\) => adapter\.installed && adapter\.chatSupported\)/,
  "Setup should not auto-select the first installed harness",
);

assert.match(
  source,
  /confirmCreateNewFamiliar/,
  "Creating a new local familiar should require an explicit confirmation state",
);

assert.match(
  source,
  /I understand this creates a new Coven familiar/,
  "Harness creation copy should make new familiar creation explicit",
);

assert.match(
  source,
  /Create new Coven familiar/,
  "Harness action should say it creates a new familiar",
);

assert.match(
  source,
  /const chatHarnesses = harnesses\.filter\(\(adapter\) => adapter\.chatSupported\);/,
  "Setup should restrict the local chat harness picker to daemon-backed chat-capable harnesses",
);

assert.match(
  source,
  /chatHarnesses\.find\([\s\S]*adapter\.id === selectedHarnessId && adapter\.installed/,
  "Creating a local familiar should resolve only from the chat-capable harness list",
);

assert.match(
  source,
  /chatHarnesses\.map\(\(adapter\) =>/,
  "Setup should render only chat-capable harnesses in the local harness picker",
);

assert.match(
  source,
  /Connect selected existing agent/,
  "OpenClaw action should say it connects an existing agent",
);

assert.match(
  source,
  /xl:col-span-8[\s\S]*Familiar details/,
  "The familiar form should span wider than chooser cards for comfortable editing",
);
