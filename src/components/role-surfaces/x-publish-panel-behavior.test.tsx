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

import { LiveRegionProvider } from "@/components/ui/live-region";
import { XPublishPanel } from "./x-publish-panel";

// The announcer clears its regions on a timer, which fires after a test ends.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    renderer = create(
      createElement(LiveRegionProvider, null, createElement(XPublishPanel, { familiarId: "nyx" })),
    );
  });
  return renderer;
}

const UNCERTAIN = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "did this go out?",
  status: "uncertain",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
  dispatchedAt: "2026-08-02T10:00:00.000Z",
};

const DRAFT = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "ship it",
  status: "draft",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function textarea(renderer) {
  return renderer.root.find((node) => node.type === "textarea");
}

/** Type, confirm, and publish once against whatever `handler` is scripted to do. */
async function draftAndPublish(renderer, wording: string) {
  await act(async () => textarea(renderer).props.onChange({ target: { value: wording } }));
  await act(async () => button(renderer, "Review this wording").props.onClick());
  await act(async () => button(renderer, "Publish to X").props.onClick());
}

/**
 * The panel's OWN subtree, serialized — never the whole tree.
 *
 * `renderer.toJSON()` also carries the announcer's two live regions, and this
 * panel announces every message it renders. An assertion over the whole tree
 * therefore passes on the announcement alone and says nothing about what the
 * room shows. Verified by mutation: with a whole-tree helper, deleting the
 * visible error element outright left all thirteen tests green — while the
 * announcement it would have been standing in for is cleared after 250ms.
 */
function panelText(renderer): string {
  const tree = renderer.toJSON();
  const roots = Array.isArray(tree) ? tree : [tree];
  return JSON.stringify(roots.filter((node) => node && node.type === "section"));
}

/** The wording previews the panel renders, in order. */
function previews(renderer): string[] {
  return renderer.root
    .findAll((node) => node.type === "pre" && node.props.className === "role-surface-content")
    .map((node) => node.children.join(""));
}

function button(renderer, label: string) {
  return renderer.root
    .findAll((node) => node.type === "button")
    .find((node) => JSON.stringify(node.children).includes(label));
}

test("a refused grant is stated, and no composer is offered underneath it", async () => {
  handler = () => ({ status: 403, body: { ok: false, error: "Enable X publishing for this familiar" } });
  const renderer = await render();

  expect(panelText(renderer)).toContain("Enable X publishing for this familiar");
  // The refusal IS the panel. Rendering a composer below it would invite
  // someone to type a post that can never go anywhere.
  expect(renderer.root.findAll((node) => node.type === "textarea")).toHaveLength(0);
});

test("an unreachable Cave is a failure, not a refusal", async () => {
  handler = () => ({ status: 500, body: null });
  const renderer = await render();

  expect(panelText(renderer)).toContain("Couldn't load X publishing.");
  // A 500 must not be reported as "publishing is not available for this
  // familiar" — that reads as a settled policy answer to a transient outage.
  expect(panelText(renderer)).not.toContain("not available for this familiar");
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
  // `role-surface-field` styles `input` and `select` only, so a textarea under
  // it needs the rooms' own textarea class or it renders with no border, no
  // background, no padding and no focus ring — none of which any behavioural
  // assertion here would notice.
  expect(textarea.props.className).toContain("role-surface-notes");
  await act(async () => textarea.props.onChange({ target: { value: "ship it" } }));

  // Before confirming there is nothing to publish with.
  expect(button(renderer, "Publish to X").props.disabled).toBe(true);

  await act(async () => button(renderer, "Review this wording").props.onClick());
  expect(button(renderer, "Publish to X").props.disabled).toBe(false);
  // The confirmation step is worth nothing unless the exact wording is put in
  // front of the person separately from the box they typed it in.
  expect(panelText(renderer)).toContain("This exact text is confirmed");
  expect(previews(renderer)).toEqual(["ship it"]);

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

  expect(panelText(renderer)).toContain("may or may not be posted");
  // The wording is the whole instruction: the person is being sent to the
  // account on X to look for THIS post. A hold that does not say what to look
  // for cannot be settled honestly.
  expect(previews(renderer)).toEqual(["did this go out?"]);
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
  expect(panelText(renderer)).toContain("Enter the post's numeric ID");
  expect(requests.some((request) => request.body?.action === "resolve")).toBe(false);
});

test("a pasted post address is refused by the field, not by a round trip", async () => {
  handler = (url, init) =>
    init?.method === "POST"
      ? { body: { ok: true, publication: UNCERTAIN } }
      : { body: { ok: true, publications: [UNCERTAIN] } };
  const renderer = await render();

  const input = renderer.root.find((node) => node.type === "input");
  await act(async () =>
    input.props.onChange({ target: { value: "https://x.com/nyx/status/1234567890123456789" } }));
  await act(async () => button(renderer, "It posted").props.onClick());

  // The store's id is digits only. Sending the address would come back as the
  // route's generic refusal, aimed at nothing the person can see.
  expect(panelText(renderer)).toContain("digits only");
  expect(requests.some((request) => request.body?.action === "resolve")).toBe(false);
});

test("a 500 carrying the route's own envelope is still a failure, not a refusal", async () => {
  // This is what the route actually returns for an internal error: `ok: false`
  // with a message, at status 500. Only the status separates it from a policy
  // refusal, so a loader reading the envelope alone would present an outage as
  // a settled answer — with no retry offered.
  handler = () => ({
    status: 500,
    body: { ok: false, code: "internal", error: "X request could not be completed" },
  });
  const renderer = await render();

  expect(panelText(renderer)).toContain("Couldn't load X publishing.");
  expect(panelText(renderer)).toContain("Retry");
});

test("an ok envelope with no list is a failure, not a refusal", async () => {
  handler = () => ({ status: 200, body: { ok: true } });
  const renderer = await render();

  expect(panelText(renderer)).toContain("Couldn't load X publishing.");
  expect(panelText(renderer)).not.toContain("not available for this familiar");
});

test("a failed publish surfaces the record it left behind", async () => {
  let stored: Array<Record<string, unknown>> = [];
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: stored } };
    const body = JSON.parse(String(init.body));
    if (body.action === "draft") {
      return {
        body: {
          ok: true,
          publication: { ...DRAFT, text: body.text },
          confirmationToken: "t",
        },
      };
    }
    // The ambiguous case: dispatched, outcome unknown. The store has already
    // written `uncertain` by the time it answers.
    stored = [{ ...UNCERTAIN, id: DRAFT.id, text: "ship it" }];
    return {
      status: 502,
      body: { ok: false, error: "A previous attempt may already have posted." },
    };
  };
  const renderer = await render();
  await draftAndPublish(renderer, "ship it");

  expect(panelText(renderer)).toContain("A previous attempt may already have posted.");
  // Reloading on the failure path is the whole point: without it the room
  // never learns about the record, so nothing holds the composer and the
  // resolve form that settles it is unreachable from the room that made it.
  expect(panelText(renderer)).toContain("may or may not be posted");
  expect(button(renderer, "It posted")).toBeTruthy();
  expect(textarea(renderer).props.disabled).toBe(true);
});

test("settling the attempt leaves the composer usable, not wedged on a spent id", async () => {
  const SECOND_ID = "33333333-3333-4333-8333-333333333333";
  let stored: Array<Record<string, unknown>> = [];
  let minted = 0;
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: stored } };
    const body = JSON.parse(String(init.body));

    if (body.action === "draft") {
      const existing = stored.find((entry) => entry.id === body.publicationId);
      // The store's own rule: only a draft may be edited. A panel that clung
      // to a settled id would earn this refusal on every attempt, forever.
      if (body.publicationId !== undefined && existing?.status !== "draft") {
        return {
          status: 400,
          body: { ok: false, error: `A ${existing?.status ?? "missing"} X post cannot be edited` },
        };
      }
      if (existing) {
        existing.text = body.text;
        return { body: { ok: true, publication: { ...existing }, confirmationToken: "t" } };
      }
      minted += 1;
      const record = { ...DRAFT, id: minted === 1 ? DRAFT.id : SECOND_ID, text: body.text };
      stored = [...stored, record];
      return { body: { ok: true, publication: record, confirmationToken: "t" } };
    }

    if (body.action === "publish") {
      stored = [{ ...UNCERTAIN, id: DRAFT.id, text: "ship it" }];
      return {
        status: 502,
        body: { ok: false, error: "A previous attempt may already have posted." },
      };
    }

    stored = [{ ...DRAFT, text: "ship it", status: "abandoned" }];
    return { body: { ok: true, publication: stored[0] } };
  };
  const renderer = await render();
  await draftAndPublish(renderer, "ship it");
  await act(async () => button(renderer, "It did not post").props.onClick());

  // The wording survives the settlement; the approval it was minted under does
  // not, because the record it names can no longer be published or edited.
  expect(textarea(renderer).props.value).toBe("ship it");
  expect(textarea(renderer).props.disabled).toBe(false);
  expect(button(renderer, "Publish to X").props.disabled).toBe(true);
  expect(button(renderer, "Review this wording").props.disabled).toBe(false);

  await act(async () => button(renderer, "Review this wording").props.onClick());
  const redraft = requests.filter((request) => request.body?.action === "draft").at(-1);
  expect(redraft?.body?.publicationId).toBeUndefined();
  expect(panelText(renderer)).not.toContain("cannot be edited");
  expect(button(renderer, "Publish to X").props.disabled).toBe(false);
});

test("a publish the store had already sent says so rather than implying a second post", async () => {
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: [] } };
    const body = JSON.parse(String(init.body));
    if (body.action === "draft") {
      return {
        body: { ok: true, publication: { ...DRAFT, text: body.text }, confirmationToken: "t" },
      };
    }
    return {
      body: {
        ok: true,
        publication: { ...DRAFT, status: "published", postId: "1234567890123456789" },
        alreadyPublished: true,
      },
    };
  };
  const renderer = await render();
  await draftAndPublish(renderer, "ship it");

  expect(panelText(renderer)).toContain("Nothing new was sent");
});

test("a lost publish response is reconciled from the record, not left inviting a retype", async () => {
  const publishedRecord = {
    ...DRAFT,
    text: "ship it",
    status: "published",
    postId: "1234567890123456789",
    canonicalUrl: "https://x.com/nyx/status/1234567890123456789",
    publishedAt: "2026-08-02T10:00:00.000Z",
  };
  let stored: Array<Record<string, unknown>> = [];
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: stored } };
    const body = JSON.parse(String(init.body));
    if (body.action === "draft") {
      return {
        body: { ok: true, publication: { ...DRAFT, text: body.text }, confirmationToken: "t" },
      };
    }
    // The post went out; only the answer was lost.
    stored = [publishedRecord];
    return { status: 502, body: { ok: false, error: "X did not answer" } };
  };
  const renderer = await render();
  await draftAndPublish(renderer, "ship it");

  expect(panelText(renderer)).toContain("recorded as published");
  // What did go out is listed, with the id that names it. Without this the
  // room's only account of the post is a notice that clears on the next click.
  expect(
    renderer.root.findAll(
      (node) => node.type === "li" && node.props.className === "role-surface-list-row",
    ),
  ).toHaveLength(1);
  expect(panelText(renderer)).toContain("1234567890123456789");
  // Leaving the wording in the box next to an error is how the same post gets
  // sent twice by hand.
  expect(textarea(renderer).props.value).toBe("");
  // …and the error that reported the lost answer as a failure is retracted,
  // because the record says the post is not lost at all.
  expect(
    renderer.root.findAll(
      (node) => node.props?.className === "role-surface-notice role-surface-notice--error",
    ),
  ).toHaveLength(0);
});

test("an approval survives a list that does not name its record", async () => {
  // The reconciliation effect drops an approval whose record has left `draft`.
  // It must NOT also drop one whose record is simply absent, and the reason is
  // timing rather than tolerance: a confirmation is set before the reload that
  // would fetch the list naming its draft, so the effect necessarily runs
  // against lists that predate the record. This holds the permanent form of
  // that window — a list that never names the record at all — because it is
  // the one a test can pin deterministically. Verified by mutation: clearing on
  // `!record` fails five of the tests in this file.
  handler = (url, init) => {
    if (init?.method !== "POST") return { body: { ok: true, publications: [] } };
    return {
      body: { ok: true, publication: { ...DRAFT, text: "ship it" }, confirmationToken: "t" },
    };
  };
  const renderer = await render();

  await act(async () => textarea(renderer).props.onChange({ target: { value: "ship it" } }));
  await act(async () => button(renderer, "Review this wording").props.onClick());

  expect(button(renderer, "Publish to X").props.disabled).toBe(false);
  expect(previews(renderer)).toEqual(["ship it"]);
});
