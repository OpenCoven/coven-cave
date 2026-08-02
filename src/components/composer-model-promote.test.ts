// @ts-nocheck
// Promote a session model to the familiar default (cave-pkapw).
//
// handleSelectModel sends scope = sessionId ? "session" : "familiar-default".
// So a brand-new chat's pick already becomes the familiar's durable default,
// while a pick INSIDE a session is session-scoped and leaves that default
// alone — "use this for every new chat" had no path from the composer, only
// from Home or the Familiar studio.
//
// The two things worth pinning are the ones that could silently rot: the scope
// it sends (wrong scope = writes the wrong record) and when the row is offered
// (always-on = a no-op action users learn to ignore).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("./composer-runtime-chip.tsx", import.meta.url), "utf8");
const chips = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/model-state/route.ts", import.meta.url), "utf8");

test("promotion reuses the existing server mechanism, not a new store", () => {
  // cave-x0k78 was closed because a second (localStorage) store would compete
  // with this server-side config for the same value. Promotion must go through
  // the same route a brand-new chat's pick uses.
  assert.match(chatView, /scope: "familiar-default"/, "promotion PATCHes familiar-default scope");
  assert.match(
    route,
    /if \(scope === "familiar-default"\)[\s\S]{0,200}?saveConfig\(/,
    "the route persists familiar-default to config",
  );
  assert.doesNotMatch(
    chatView,
    /localStorage[^\n]{0,60}model[^\n]{0,40}default/i,
    "no client-side model-default store — the server config is the one source",
  );
});

test("the promote PATCH omits sessionId, or it would write session scope", () => {
  const body = chatView.match(
    /const handlePromoteModelToDefault = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/,
  )?.[0] ?? "";
  assert.ok(body, "the handler exists");
  assert.match(body, /familiarId: familiar\.id/, "targets the familiar");
  assert.match(body, /scope: "familiar-default"/, "sends familiar-default");
  assert.doesNotMatch(body, /sessionId/, "must NOT send sessionId — that would scope it to the session");
  assert.match(body, /refreshModelState\(\)/, "re-reads server state rather than trusting the write");
});

test("the row is offered only when it would do something", () => {
  assert.match(
    chatView,
    /modelState\?\.source === "session" && modelState\.effectiveModel !== "unknown"/,
    "promotable only when the model is session-scoped and known",
  );
  assert.match(
    popover,
    /\{promotableModel && onPromoteModelToDefault \? \(/,
    "the popover hides the row when there is nothing to promote",
  );
});

test("the props are threaded, not dropped mid-way", () => {
  // A prop typed but never passed is the quiet failure here: the row would
  // never render and look like a feature that does not work.
  assert.match(chips, /promotableModel=\{context\.config\.promotableModel \?\? null\}/, "chips pass it down");
  assert.match(chips, /onPromoteModelToDefault=\{context\.config\.onPromoteModelToDefault\}/, "and the handler");
  assert.match(chatView, /promotableModel=\{promotableModel\}/, "chat-view supplies it");
});
