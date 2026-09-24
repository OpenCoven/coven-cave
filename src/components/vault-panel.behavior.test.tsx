// @ts-nocheck — react-test-renderer has no declarations in this repository.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LiveRegionProvider } from "./ui/live-region";
import { VaultPanel } from "./vault-panel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderer;
let requests;
let mappings;
let saveFails;

const nodeText = (node) => typeof node === "string"
  ? node
  : (node.children ?? []).map(nodeText).join("");
const buttons = (label) => renderer.root.findAll((node) =>
  node.type === "button" && nodeText(node).trim() === label);
const input = () => renderer.root.findByProps({ name: "environmentVariable" });
const value = () => renderer.root.findByType("textarea");
const submit = () => act(async () => {
  await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
});

beforeEach(() => {
  requests = [];
  mappings = [];
  saveFails = false;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (url !== "/api/vault") throw new Error(`Unexpected request: ${url}`);
    if (init?.method === "POST") {
      if (saveFails) return Response.json({ ok: false, error: "Couldn't save the variable. Try again." }, { status: 500 });
      const payload = JSON.parse(init.body);
      mappings = (payload.entries ?? [payload]).map((entry) => ({
        key: entry.key, storage: entry.storage, ref: entry.ref ?? null,
        scope: "shared", required: false, description: null,
        status: entry.storage === "encrypted" ? "encrypted" : "configured",
        hasValue: entry.storage === "encrypted",
      }));
    }
    return Response.json({ ok: true, mappings });
  }));
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function renderVault(familiarId?: string) {
  await act(async () => {
    renderer = create(<LiveRegionProvider><VaultPanel familiarId={familiarId} /></LiveRegionProvider>);
  });
}

async function openForm() {
  await act(async () => buttons("Add environment variable")[0].props.onClick());
}

test("empty setup offers manual entry without connecting or reading the clipboard", async () => {
  const clipboardRead = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { readText: clipboardRead } });
  await renderVault();
  expect(nodeText(renderer.root)).toContain("No environment variables added");
  await openForm();
  expect(input().props.value).toBe("");
  expect(value().props.value).toBe("");
  expect(value().props.autoComplete).toBe("off");
  expect(renderer.root.findByType("details").props.open).toBeFalsy();
  expect(clipboardRead).not.toHaveBeenCalled();
  expect(requests).toEqual([{ url: "/api/vault", method: "GET", body: undefined }]);
  await act(async () => buttons("Cancel")[0].props.onClick());
  expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

test("manual entry saves an encrypted variable only after Save variable", async () => {
  await renderVault();
  await openForm();
  await act(async () => {
    input().props.onChange({ target: { value: "MY_API_KEY" } });
    value().props.onChange({ target: { value: "fixture-manual-value" } });
  });
  expect(buttons("Save variable")).toHaveLength(1);
  expect(requests).toHaveLength(1);
  await submit();
  const post = requests.find((request) => request.method === "POST");
  expect(JSON.parse(post.body)).toEqual({ key: "MY_API_KEY", storage: "encrypted", value: "fixture-manual-value", required: false });
  expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
  expect(nodeText(renderer.root)).toContain("MY_API_KEY");
  expect(nodeText(renderer.root)).not.toContain("fixture-manual-value");
});

test("pasting multiple environment variables previews names and saves the explicit batch", async () => {
  await renderVault();
  await openForm();
  await act(async () => value().props.onChange({ target: { value: "FIRST_KEY=fixture-first\nSECOND_KEY=fixture-second" } }));
  expect(input().props.required).toBe(false);
  expect(nodeText(renderer.root)).toContain("Detected 2 entries: FIRST_KEY, SECOND_KEY");
  expect(requests).toHaveLength(1);
  await submit();
  expect(JSON.parse(requests.find((request) => request.method === "POST").body)).toEqual({
    entries: [
      { key: "FIRST_KEY", storage: "encrypted", value: "fixture-first", required: false },
      { key: "SECOND_KEY", storage: "encrypted", value: "fixture-second", required: false },
    ],
  });
});

test("choosing 1Password does not contact it or save a reference before submission", async () => {
  await renderVault();
  await openForm();
  await act(async () => buttons("1Password")[0].props.onClick());
  await act(async () => {
    input().props.onChange({ target: { value: "MY_API_KEY" } });
    value().props.onChange({ target: { value: "op://Personal/Chosen/credential" } });
  });
  expect(nodeText(renderer.root)).toContain("1Password may ask you to unlock");
  expect(requests).toHaveLength(1);
  await submit();
  expect(JSON.parse(requests.find((request) => request.method === "POST").body)).toEqual({
    key: "MY_API_KEY", storage: "1password", ref: "op://Personal/Chosen/credential", required: false,
  });
});

test("failed saves preserve the entered value and expose an actionable error", async () => {
  saveFails = true;
  await renderVault();
  await openForm();
  await act(async () => {
    input().props.onChange({ target: { value: "MY_API_KEY" } });
    value().props.onChange({ target: { value: "fixture-retry-value" } });
  });
  await submit();
  expect(value().props.value).toBe("fixture-retry-value");
  expect(nodeText(renderer.root)).toContain("Couldn't save the variable. Try again.");
  expect(buttons("Save variable")[0].props.disabled).toBe(false);
});

test("mixed .env batches disclose provider access before saving", async () => {
  await renderVault();
  await openForm();
  await act(async () => value().props.onChange({ target: {
    value: "LOCAL_KEY=fixture-local\nREMOTE_KEY=op://Personal/Chosen/credential",
  } }));
  expect(nodeText(renderer.root)).toContain("1Password may ask you to unlock");
  expect(requests).toHaveLength(1);
  await submit();
  expect(JSON.parse(requests.find((request) => request.method === "POST").body).entries).toEqual([
    { key: "LOCAL_KEY", storage: "encrypted", value: "fixture-local", required: false },
    { key: "REMOTE_KEY", storage: "1password", ref: "op://Personal/Chosen/credential", required: false },
  ]);
});

test("a familiar's Vault exposes a review action for legacy references without widening grants", async () => {
  mappings = [{
    key: "LEGACY_KEY", ref: "op://Development/OpenAI API Key 2/credential",
    storage: "1password", scope: ["sage"], required: false, description: null,
    status: "unresolved", hasValue: false, needsConfirmation: true,
    error: "This reference matches an old Cave default.",
  }];
  await renderVault("sage");
  await act(async () => buttons("Review reference")[0].props.onClick());
  expect(requests).toHaveLength(1);
  await submit();
  expect(JSON.parse(requests.find((request) => request.method === "POST").body)).toEqual({
    key: "LEGACY_KEY", storage: "1password", ref: "op://Development/OpenAI API Key 2/credential",
    required: false, scope: ["sage"],
  });
});

test("switching review entries keeps the selected values and grants together", async () => {
  mappings = [
    { key: "FIRST_KEY", ref: "op://Development/OpenAI API Key 2/credential", scope: ["sage"] },
    { key: "SECOND_KEY", ref: "op://Development/ElevenLabs API Key/credential", scope: ["nova"] },
  ].map((entry) => ({
    ...entry, storage: "1password", required: false, description: null,
    status: "unresolved", hasValue: false, needsConfirmation: true,
  }));
  await renderVault("sage");
  await act(async () => buttons("Review reference")[0].props.onClick());
  await act(async () => buttons("Review reference")[1].props.onClick());
  expect(input().props.value).toBe("SECOND_KEY");
  expect(value().props.value).toBe("op://Development/ElevenLabs API Key/credential");
  expect(requests).toHaveLength(1);
  await submit();
  expect(JSON.parse(requests.find((request) => request.method === "POST").body)).toEqual({
    key: "SECOND_KEY", storage: "1password", ref: "op://Development/ElevenLabs API Key/credential",
    required: false, scope: ["nova"],
  });
});
