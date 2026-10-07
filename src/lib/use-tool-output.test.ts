// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, StrictMode, useMemo } from "react";
import { act, create } from "react-test-renderer";
import { useToolOutput } from "./use-tool-output.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function fixture() {
  const calls = [];
  const paints = [];
  const load = (session, tool, signal) => new Promise((resolve, reject) => calls.push({ session, tool, signal, resolve, reject }));
  let state;
  function Probe({ session = "s", tool = "t", open = false, revision }) {
    const target = useMemo(() => ({ id: tool, outputSessionId: session }), [session, tool, revision]);
    state = useToolOutput(target, open, load);
    paints.push({ session, tool, open, ...state });
    return null;
  }
  return { calls, paints, Probe, state: () => state };
}

test("a disclosure loads once while open, clears on close and rechecks on reopen", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(f.Probe)); });
    assert.equal(f.calls.length, 0);
    await act(async () => view.update(createElement(f.Probe, { open: true })));
    assert.equal(f.calls.length, 1);
    await act(async () => f.calls[0].resolve("first authorized result"));
    assert.equal(f.state().text, "first authorized result");
    await act(async () => view.update(createElement(f.Probe, { open: true })));
    assert.equal(f.calls.length, 1, "rerendering an open card does not refetch");
    await act(async () => view.update(createElement(f.Probe, { open: false })));
    assert.equal(f.state().text, undefined);
    assert.equal(f.calls[0].signal.aborted, true);
    await act(async () => view.update(createElement(f.Probe, { open: true })));
    assert.equal(f.state().text, undefined);
    assert.equal(f.calls.length, 2);
    await act(async () => f.calls[1].reject(new Error("access revoked")));
    assert.equal(f.state().status, "error");
    assert.equal(f.state().text, undefined);
  } finally { await act(async () => view?.unmount()); }
});

test("scope replacement suppresses old content before effects and ignores late replies", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(f.Probe, { session: "original", open: true })); });
    await act(async () => f.calls[0].resolve("ORIGINAL_PRIVATE_OUTPUT"));
    const before = f.paints.length;
    await act(async () => view.update(createElement(f.Probe, { session: "replacement", open: true })));
    assert.ok(f.paints.slice(before).every((paint) => paint.text === undefined), "old output is not visible even on the first replacement paint");
    assert.equal(f.calls[0].signal.aborted, true);
    await act(async () => view.update(createElement(f.Probe, { session: "third", open: true })));
    await act(async () => f.calls[1].resolve("LATE_REPLACEMENT_OUTPUT"));
    assert.equal(f.state().text, undefined);
    await act(async () => f.calls[2].resolve("third"));
    assert.equal(f.state().text, "third");
    assert.deepEqual(f.calls.map((c) => c.session), ["original", "replacement", "third"]);
  } finally { await act(async () => view?.unmount()); }
});

test("tool replacement, retry and unmount cancel obsolete reads", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(f.Probe, { tool: "a", open: true })); });
    await act(async () => view.update(createElement(f.Probe, { tool: "b", open: true })));
    assert.equal(f.calls[0].signal.aborted, true);
    await act(async () => f.calls[0].reject(new Error("late private error")));
    assert.equal(f.state().status, "loading");
    await act(async () => f.calls[1].reject(new Error("offline")));
    assert.equal(f.state().status, "error");
    await act(async () => f.state().retry());
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[1].signal.aborted, true);
    await act(async () => view.unmount()); view = null;
    assert.equal(f.calls[2].signal.aborted, true);
    const before = f.paints.length;
    await act(async () => f.calls[2].resolve("late after unmount"));
    assert.equal(f.paints.length, before);
  } finally { await act(async () => view?.unmount()); }
});

test("an unavailable history source never guesses another session", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(f.Probe, { session: "", open: true })); });
    assert.equal(f.state().status, "error");
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => view?.unmount()); }
});

test("StrictMode cleanup refuses the first replayed effect's late result", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(StrictMode, null, createElement(f.Probe, { open: true }))); });
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].signal.aborted, true);
    await act(async () => f.calls[0].resolve("obsolete effect"));
    assert.equal(f.state().text, undefined);
    await act(async () => f.calls[1].resolve("current effect"));
    assert.equal(f.state().text, "current effect");
  } finally { await act(async () => view?.unmount()); }
});


test("replacing a history record revokes its loaded output even when IDs match", async () => {
  const f = fixture(); let view;
  try {
    await act(async () => { view = create(createElement(f.Probe, { open: true, revision: {} })); });
    await act(async () => f.calls[0].resolve("OLD_HISTORY_OUTPUT"));
    assert.equal(f.state().text, "OLD_HISTORY_OUTPUT");
    const before = f.paints.length;
    await act(async () => view.update(createElement(f.Probe, { open: true, revision: {} })));
    assert.ok(f.paints.slice(before).every((paint) => paint.text === undefined));
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.calls.length, 2);
    await act(async () => f.calls[1].reject(new Error("output deleted")));
    assert.equal(f.state().status, "error");
    assert.equal(f.state().text, undefined);
  } finally { await act(async () => view?.unmount()); }
});
