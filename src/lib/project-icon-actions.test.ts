/**
 * Behavioural guards for the Generate/Regenerate AI icon action.
 *
 * Both collaborators are stubs that record what they were asked to do, so each
 * test asserts an outcome — what was requested, what was persisted, what was
 * refused before anything was persisted — rather than the shape of the source.
 * Nothing here touches the network or IndexedDB.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { generateProjectIcon, SAFE_ICON_MIMES } from "./project-icon-actions.ts";

type SaveCall = { root: string; dataUrl: string; mime: string };

/** Records every save and answers with `reply`. */
function recordingSave(reply: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const calls: SaveCall[] = [];
  return {
    calls,
    saveImage: async (root: string, image: { dataUrl: string; mime: string }) => {
      calls.push({ root, ...image });
      return reply;
    },
  };
}

type FetchCall = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

/** Records every request and answers with `reply` (or throws it). */
function recordingFetch(reply: Response | Error | (() => Response)) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers,
    });
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply() : reply;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WEBP_DATA_URL = "data:image/webp;base64,UklGRhoAAABXRUJQ";

// ── the happy path ──────────────────────────────────────────────────────────

test("generates an icon and persists it under the normalized project root", async () => {
  const save = recordingSave();
  const net = recordingFetch(jsonResponse({ ok: true, dataUrl: WEBP_DATA_URL, mime: "image/webp" }));

  const result = await generateProjectIcon(
    { name: "coven-cave", root: "C:\\Users\\dev\\coven-cave\\", variant: 7, model: "openai/gpt-5.5" },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.dataUrl, WEBP_DATA_URL);
    assert.equal(result.mime, "image/webp");
  }

  // The request carries the project's root VERBATIM (whitespace aside). That
  // is deliberate and load-bearing: the server derives the icon hue with
  // projectRootHash(root), and ProjectAvatar tints the tile with
  // projectTint(project.root) — the un-normalized string. Normalizing here
  // would hash a different string than the tile does and the generated icon
  // would land on a different colour from the tile it replaces.
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, "/api/projects/icon");
  assert.equal(net.calls[0].headers["content-type"], "application/json");
  assert.deepEqual(net.calls[0].body, {
    name: "coven-cave",
    root: "C:\\Users\\dev\\coven-cave\\",
    variant: 7,
    model: "openai/gpt-5.5",
  });

  // The write, by contrast, IS keyed by the normalized root — the identity
  // every other surface buckets by — so the icon resolves in the sidebar,
  // picker and board. The two differ here, which is the point.
  assert.equal(save.calls.length, 1);
  assert.equal(save.calls[0].root, "C:/Users/dev/coven-cave");
  assert.notEqual(
    save.calls[0].root,
    net.calls[0].body.root,
    "storage key is normalized; the hashed root is not",
  );
  assert.equal(save.calls[0].dataUrl, WEBP_DATA_URL);
  assert.equal(save.calls[0].mime, "image/webp");
});

test("omits the model when there is none, rather than sending an empty one", async () => {
  const save = recordingSave();
  const net = recordingFetch(jsonResponse({ ok: true, dataUrl: WEBP_DATA_URL, mime: "image/webp" }));
  await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.deepEqual(net.calls[0].body, { name: "app", root: "/tmp/app", variant: 0 });
});

test("regeneration sends a different variant for the same project", async () => {
  const save = recordingSave();
  const net = recordingFetch(() =>
    jsonResponse({ ok: true, dataUrl: WEBP_DATA_URL, mime: "image/webp" }),
  );
  const deps = { fetchImpl: net.fetchImpl, saveImage: save.saveImage };
  await generateProjectIcon({ name: "app", root: "/tmp/app", variant: 1 }, deps);
  await generateProjectIcon({ name: "app", root: "/tmp/app", variant: 2 }, deps);

  assert.equal(net.calls[0].body.variant, 1);
  assert.equal(net.calls[1].body.variant, 2);
  // Identity inputs stay put — only the variant moves, so the hue cannot.
  assert.equal(net.calls[0].body.root, net.calls[1].body.root);
  assert.equal(net.calls[0].body.name, net.calls[1].body.name);
});

// ── refusals that must never write ──────────────────────────────────────────

test("an SVG icon is refused and never persisted", async () => {
  // The project-image store itself accepts image/svg+xml. This path must not:
  // an SVG data URL is active content, and nothing upstream should produce one.
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse({
      ok: true,
      dataUrl: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=",
      mime: "image/svg+xml",
    }),
  );

  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );

  assert.equal(result.ok, false);
  assert.equal(save.calls.length, 0, "an SVG must never reach the project-image store");
  assert.ok(!SAFE_ICON_MIMES.includes("image/svg+xml" as never));
});

test("a mime label that disagrees with the payload is refused", async () => {
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse({
      ok: true,
      // Labelled WebP, actually an SVG payload.
      dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      mime: "image/webp",
    }),
  );

  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );

  assert.equal(result.ok, false);
  assert.equal(save.calls.length, 0, "label and payload must agree before a write");
});

test("a success body with no data URL is refused", async () => {
  const save = recordingSave();
  const net = recordingFetch(jsonResponse({ ok: true, mime: "image/webp" }));
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  assert.equal(save.calls.length, 0);
});

test("an empty name or root is refused before any request is made", async () => {
  for (const input of [
    { name: "  ", root: "/tmp/app", variant: 0 },
    { name: "app", root: "   ", variant: 0 },
  ]) {
    const save = recordingSave();
    const net = recordingFetch(jsonResponse({ ok: true, dataUrl: WEBP_DATA_URL, mime: "image/webp" }));
    const result = await generateProjectIcon(input, {
      fetchImpl: net.fetchImpl,
      saveImage: save.saveImage,
    });
    assert.equal(result.ok, false);
    assert.equal(net.calls.length, 0, "no request should be made for incomplete input");
    assert.equal(save.calls.length, 0);
  }
});

// ── failures, and the message each one surfaces ─────────────────────────────

test("a missing vault key surfaces the endpoint's actionable hint", async () => {
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse(
      {
        ok: false,
        error: "vault_key_unresolved",
        missingKey: "OPENAI_API_KEY",
        hint: "Set OPENAI_API_KEY in Vault settings to generate project icons.",
      },
      400,
    ),
  );
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /OPENAI_API_KEY/);
    assert.match(result.message, /Vault/);
  }
  assert.equal(save.calls.length, 0);
});

test("a missing vault key still names the key when no hint was sent", async () => {
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse({ ok: false, error: "vault_key_unresolved", missingKey: "GOOGLE_API_KEY" }, 400),
  );
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /GOOGLE_API_KEY/);
});

test("a provider refusal surfaces the provider's own message", async () => {
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse(
      {
        ok: false,
        error: "provider_generation_failed",
        providerMessage: "Billing hard limit reached",
      },
      502,
    ),
  );
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Billing hard limit reached/);
});

test("a rate limit surfaces the endpoint's retry guidance", async () => {
  const save = recordingSave();
  const net = recordingFetch(
    jsonResponse(
      {
        ok: false,
        error: "rate_limited",
        retryAfterSeconds: 37,
        hint: "Try again in 37 seconds.",
      },
      429,
    ),
  );
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message, "Try again in 37 seconds.");
  assert.equal(save.calls.length, 0);
});

test("every untrusted-image refusal reads as one unusable-image message", async () => {
  for (const error of [
    "unsupported_image_format",
    "undecodable_image",
    "image_too_large",
    "provider_empty_image",
  ]) {
    const save = recordingSave();
    const net = recordingFetch(jsonResponse({ ok: false, error }, 502));
    const result = await generateProjectIcon(
      { name: "app", root: "/tmp/app", variant: 0 },
      { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
    );
    assert.equal(result.ok, false, error);
    if (!result.ok) assert.match(result.message, /can’t use as an icon/, error);
    assert.equal(save.calls.length, 0, error);
  }
});

test("a network failure is reported, not thrown", async () => {
  const save = recordingSave();
  const net = recordingFetch(new TypeError("Failed to fetch"));
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /desktop reachable/);
  assert.equal(save.calls.length, 0);
});

test("a non-JSON response is reported, not thrown", async () => {
  const save = recordingSave();
  const net = recordingFetch(new Response("<html>502</html>", { status: 502 }));
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false);
  assert.equal(save.calls.length, 0);
});

test("a storage refusal is surfaced instead of a false success", async () => {
  const save = recordingSave({ ok: false, reason: "Cave avatar storage full." });
  const net = recordingFetch(jsonResponse({ ok: true, dataUrl: WEBP_DATA_URL, mime: "image/webp" }));
  const result = await generateProjectIcon(
    { name: "app", root: "/tmp/app", variant: 0 },
    { fetchImpl: net.fetchImpl, saveImage: save.saveImage },
  );
  assert.equal(result.ok, false, "a refused write must not report success");
  if (!result.ok) assert.match(result.message, /storage full/);
});

console.log("project-icon-actions.test.ts: ok");
