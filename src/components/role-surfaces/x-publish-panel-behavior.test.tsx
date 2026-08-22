// @ts-nocheck
// The panel's behaviour against a scripted `/api/x/publish`. The model rules
// live in src/lib/x-publish-composer.test.ts; what is checked here is the wiring
// the model cannot see — which request goes out, with which token, and what the
// room does when the answer is a refusal rather than a failure.
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/icon", () => ({
  Icon: () => createElement("span"),
}));

import { XPublishPanel } from "./x-publish-panel";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

let handler: Handler;
let requests: Array<{ url: string; body: Record<string, unknown> | null }>;

beforeEach(() => {
  requests = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const { status = 200, body } = handler(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
});

async function render() {
  let renderer;
  await act(async () => {
    renderer = create(createElement(XPublishPanel, { familiarId: "nyx" }));
  });
  return renderer;
}

const text = (renderer) => JSON.stringify(renderer.toJSON());

function button(renderer, label: string) {
  return renderer.root
    .findAll((node) => node.type === "button")
    .find((node) => JSON.stringify(node.children).includes(label));
}

test("a refused grant is stated, and no composer is offered underneath it", async () => {
  handler = () => ({ status: 403, body: { ok: false, error: "Enable X publishing for this familiar" } });
  const renderer = await render();

  expect(text(renderer)).toContain("Enable X publishing for this familiar");
  // The refusal IS the panel. Rendering a composer below it would invite
  // someone to type a post that can never go anywhere.
  expect(renderer.root.findAll((node) => node.type === "textarea")).toHaveLength(0);
});

test("an unreachable Cave is a failure, not a refusal", async () => {
  handler = () => ({ status: 500, body: null });
  const renderer = await render();

  expect(text(renderer)).toContain("Couldn't load X publishing.");
  // A 500 must not be reported as "publishing is not available for this
  // familiar" — that reads as a settled policy answer to a transient outage.
  expect(text(renderer)).not.toContain("not available for this familiar");
});

test("publishing sends the token minted for the exact text that was confirmed", async () => {
  const publication = {
    id: "11111111-1111-4111-8111-111111111111",
    text: "ship it",
    status: "draft",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: [] } };
    const body = JSON.parse(String(init.body));
    if (body.action === "draft") {
      return { body: { ok: true, publication: { ...publication, text: body.text }, confirmationToken: "token-for-ship-it" } };
    }
    return { body: { ok: true, publication: { ...publication, status: "published" } } };
  };
  const renderer = await render();

  const textarea = renderer.root.find((node) => node.type === "textarea");
  await act(async () => textarea.props.onChange({ target: { value: "ship it" } }));

  // Before confirming there is nothing to publish with.
  expect(button(renderer, "Publish to X").props.disabled).toBe(true);

  await act(async () => button(renderer, "Review this wording").props.onClick());
  expect(button(renderer, "Publish to X").props.disabled).toBe(false);

  await act(async () => button(renderer, "Publish to X").props.onClick());
  const published = requests.find((request) => request.body?.action === "publish");
  expect(published?.body).toMatchObject({
    familiarId: "nyx",
    publicationId: publication.id,
    confirmationToken: "token-for-ship-it",
  });
});

test("editing after confirming withdraws the approval before it can be used", async () => {
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: [] } };
    return {
      body: {
        ok: true,
        publication: {
          id: "11111111-1111-4111-8111-111111111111",
          text: JSON.parse(String(init.body)).text,
          status: "draft",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        confirmationToken: "token",
      },
    };
  };
  const renderer = await render();
  const textarea = renderer.root.find((node) => node.type === "textarea");

  await act(async () => textarea.props.onChange({ target: { value: "ship it" } }));
  await act(async () => button(renderer, "Review this wording").props.onClick());
  expect(button(renderer, "Publish to X").props.disabled).toBe(false);

  await act(async () => textarea.props.onChange({ target: { value: "ship it now" } }));
  expect(button(renderer, "Publish to X").props.disabled).toBe(true);
});

test("an unresolved attempt holds the composer until a human settles it", async () => {
  const uncertain = {
    id: "22222222-2222-4222-8222-222222222222",
    text: "did this go out?",
    status: "uncertain",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    dispatchedAt: "2026-08-02T10:00:00.000Z",
  };
  let resolved = false;
  handler = (url, init) => {
    if (init?.method !== "POST") {
      return { body: { ok: true, publications: resolved ? [{ ...uncertain, status: "abandoned" }] : [uncertain] } };
    }
    resolved = true;
    return { body: { ok: true, publication: { ...uncertain, status: "abandoned" } } };
  };
  const renderer = await render();

  expect(text(renderer)).toContain("may or may not be posted");
  expect(renderer.root.find((node) => node.type === "textarea").props.disabled).toBe(true);
  expect(button(renderer, "Publish to X").props.disabled).toBe(true);

  await act(async () => button(renderer, "It did not post").props.onClick());
  expect(requests.at(-2)?.body).toMatchObject({
    action: "resolve",
    publicationId: uncertain.id,
    outcome: "abandoned",
  });
  // Settled: the composer comes back rather than staying held forever.
  expect(renderer.root.find((node) => node.type === "textarea").props.disabled).toBe(false);
});

test("resolving as posted refuses without the post id, and never guesses one", async () => {
  const uncertain = {
    id: "22222222-2222-4222-8222-222222222222",
    text: "did this go out?",
    status: "uncertain",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    dispatchedAt: "2026-08-02T10:00:00.000Z",
  };
  handler = (url, init) =>
    init?.method === "POST"
      ? { body: { ok: true, publication: uncertain } }
      : { body: { ok: true, publications: [uncertain] } };
  const renderer = await render();

  await act(async () => button(renderer, "It posted").props.onClick());
  expect(text(renderer)).toContain("Enter the post's numeric ID");
  expect(requests.some((request) => request.body?.action === "resolve")).toBe(false);
});
