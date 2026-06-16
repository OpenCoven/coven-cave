// @ts-nocheck
import assert from "node:assert/strict";
import { copyText } from "./clipboard.ts";

const origNavigator = globalThis.navigator;
const origDocument = globalThis.document;

function restore() {
  if (origNavigator === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, "navigator", { value: origNavigator, configurable: true });
  if (origDocument === undefined) delete globalThis.document;
  else globalThis.document = origDocument;
}

function setNavigator(value) {
  // navigator is a getter-only global in Node; redefine it for the test.
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
}

// 1. Secure-context path: uses navigator.clipboard.writeText, returns true.
{
  let wrote = null;
  setNavigator({ clipboard: { writeText: async (t) => { wrote = t; } } });
  globalThis.document = undefined;
  const ok = await copyText("hello secure");
  assert.equal(ok, true, "secure path resolves true");
  assert.equal(wrote, "hello secure", "secure path writes via navigator.clipboard");
  restore();
}

// 2. Non-secure fallback: no navigator.clipboard → execCommand path, returns true.
{
  setNavigator({});
  let copiedValue = null;
  let appended = 0;
  let removed = 0;
  const fakeTextarea = {
    value: "",
    style: {},
    setAttribute() {},
    select() {},
    setSelectionRange() {},
  };
  globalThis.document = {
    createElement: () => fakeTextarea,
    body: { appendChild() { appended++; }, removeChild() { removed++; } },
    getSelection: () => ({ rangeCount: 0 }),
    execCommand: (cmd) => { if (cmd === "copy") { copiedValue = fakeTextarea.value; return true; } return false; },
  };
  const ok = await copyText("hello fallback");
  assert.equal(ok, true, "fallback resolves true when execCommand succeeds");
  assert.equal(copiedValue, "hello fallback", "fallback copies the text via a textarea");
  assert.equal(appended, 1, "fallback appends exactly one textarea");
  assert.equal(removed, 1, "fallback removes the textarea it added");
  restore();
}

// 3. Fallback failure: execCommand returns false → copyText returns false.
{
  setNavigator({});
  globalThis.document = {
    createElement: () => ({ value: "", style: {}, setAttribute() {}, select() {}, setSelectionRange() {} }),
    body: { appendChild() {}, removeChild() {} },
    getSelection: () => null,
    execCommand: () => false,
  };
  const ok = await copyText("nope");
  assert.equal(ok, false, "fallback resolves false when execCommand fails");
  restore();
}

// 4. Secure-context write rejects (e.g. permission) → falls back to execCommand.
{
  setNavigator({ clipboard: { writeText: async () => { throw new Error("denied"); } } });
  let fellBack = false;
  globalThis.document = {
    createElement: () => ({ value: "", style: {}, setAttribute() {}, select() {}, setSelectionRange() {} }),
    body: { appendChild() {}, removeChild() {} },
    getSelection: () => null,
    execCommand: () => { fellBack = true; return true; },
  };
  const ok = await copyText("retry");
  assert.equal(ok, true, "a rejected secure write still succeeds via fallback");
  assert.equal(fellBack, true, "rejected secure write falls through to execCommand");
  restore();
}

console.log("clipboard.test.ts OK");
