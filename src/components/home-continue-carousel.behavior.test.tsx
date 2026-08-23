// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// mobile-drawer-inert-focus-order.test.tsx and right-chat-panel-behavior.test.tsx.
//
// Home's Continue carousel (cave-9oi1s), driven through the REAL component:
// real state, real handlers, real effects. Every assertion reads what the
// component rendered or what it called — nothing here matches source text.
//
// CONSTRAINT: this repo has neither jsdom nor happy-dom (see the note at the
// top of mobile-drawer-inert-focus-order.test.tsx), so there is no real
// `document`. react-test-renderer's `createNodeMock` supplies the two host
// refs the component reaches through — the deck and the pager — backed by the
// renderer's own live tree, so `querySelectorAll(".home-continue__card")`
// returns exactly the cards currently rendered and `.focus()` is observable.
// The browser half (focus ring visible, no viewport overflow, reduced motion)
// is covered by tests/home-continue-carousel.spec.ts and its mobile twin.

import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { HomeContinue } from "@/components/home/home-continue";

vi.mock("@/lib/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FAMILIARS = new Map([["nova", "Nova"]]);
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** Nine resumable sessions — three full pages, newest first. */
function seed(count: number, overrides: Array<Partial<Record<string, unknown>>> = []) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s-${i + 1}`,
    project_root: "/repo",
    harness: "claude",
    title: `Session ${i + 1}`,
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: iso((i + 1) * 120),
    updated_at: iso((i + 1) * 60),
    attention: { state: "none", since: null, reason: null },
    familiarId: "nova",
    ...(overrides[i] ?? {}),
  }));
}

type Harness = {
  renderer: ReturnType<typeof create>;
  focused: string[];
  cards: () => Array<{ props: Record<string, unknown> }>;
  cardTitles: () => string[];
  deckLabel: () => string;
  liveText: () => string;
  pagerButton: (label: string) => { props: Record<string, unknown> } | null;
  update: (sessions: unknown[]) => void;
};

/** The headline a sighted reader sees on a card — the rendered
 *  `.home-continue__title` text, not the button's tooltip. */
function visibleTitle(card: { findAll: (p: (n: unknown) => boolean) => Array<{ props: Record<string, unknown> }> }) {
  return String(
    card.findAll(
      (node) => typeof node.type === "string" && node.props.className === "home-continue__title",
    )[0]?.props.children,
  );
}

function mount(sessions: unknown[], onOpenSession = vi.fn()): Harness {
  const focused: string[] = [];
  let renderer: ReturnType<typeof create>;

  const cards = () =>
    renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.className === "home-continue__card",
    );

  const createNodeMock = (element: { props?: Record<string, unknown> }) => {
    const className = String(element.props?.className ?? "");
    if (className.includes("home-continue__cards")) {
      return {
        // Backed by the live tree, so this always answers with the cards on
        // the page that is rendered right now.
        querySelectorAll: () =>
          cards().map((card) => ({
            focus: () => focused.push(visibleTitle(card)),
          })),
      };
    }
    if (className.includes("home-continue__pager")) {
      return {
        querySelector: (selector: string) => {
          const match = renderer.root.findAll(
            (node) =>
              typeof node.type === "string" &&
              String(node.props.className ?? "").includes(selector.replace(".", "")),
          )[0];
          if (!match) return null;
          return { focus: () => focused.push(String(match.props["aria-label"])) };
        },
      };
    }
    return null;
  };

  act(() => {
    renderer = create(
      <HomeContinue
        sessions={sessions}
        familiarNameById={FAMILIARS}
        onOpenSession={onOpenSession}
      />,
      { createNodeMock },
    );
  });

  return {
    renderer,
    focused,
    cards,
    cardTitles: () => cards().map(visibleTitle),
    deckLabel: () =>
      renderer.root.findAll(
        (node) => typeof node.type === "string" && node.props.role === "group",
      )[0]?.props["aria-label"],
    liveText: () =>
      renderer.root.findAll(
        (node) => typeof node.type === "string" && node.props.role === "status",
      )[0]?.props.children,
    pagerButton: (label: string) =>
      renderer.root.findAll(
        (node) => typeof node.type === "string" && node.props["aria-label"] === label,
      )[0] ?? null,
    update: (next: unknown[]) => {
      act(() => {
        renderer.update(
          <HomeContinue
            sessions={next}
            familiarNameById={FAMILIARS}
            onOpenSession={onOpenSession}
          />,
        );
      });
    },
  };
}

const press = (card: { props: Record<string, unknown> }, key: string) => {
  act(() => {
    (card.props.onKeyDown as (e: unknown) => void)({ key, preventDefault: () => {} });
  });
};

const click = (node: { props: Record<string, unknown> }) => {
  act(() => {
    (node.props.onClick as () => void)();
  });
};

describe("Home Continue carousel", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mount(seed(9));
  });

  test("shows one page of three and reaches the rest through the pager", () => {
    expect(harness.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);
    expect(harness.deckLabel()).toBe("Sessions 1 to 3 of 9");

    click(harness.pagerButton("More sessions"));
    expect(harness.cardTitles()).toEqual(["Session 4", "Session 5", "Session 6"]);
    expect(harness.deckLabel()).toBe("Sessions 4 to 6 of 9");

    click(harness.pagerButton("Previous sessions"));
    expect(harness.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);
  });

  test("sessions past the third are reachable, not truncated away", () => {
    // The defect this replaces: `sessions.slice(0, 3)` dropped everything else
    // with no affordance. Walk the whole list through the carousel.
    const seen: string[] = [...harness.cardTitles()];
    while (!harness.pagerButton("More sessions").props.disabled) {
      click(harness.pagerButton("More sessions"));
      seen.push(...harness.cardTitles());
    }
    expect(seen).toEqual(Array.from({ length: 9 }, (_, i) => `Session ${i + 1}`));
  });

  test("the live region stays silent until the reader turns a page", () => {
    expect(harness.liveText()).toBe("");
    click(harness.pagerButton("More sessions"));
    expect(harness.liveText()).toBe("Sessions 4 to 6 of 9");
  });

  test("arrow keys walk the page, then carry focus onto the next page", () => {
    const [first, second, third] = harness.cards();
    press(first, "ArrowRight");
    expect(harness.focused.at(-1)).toBe("Session 2");

    press(second, "ArrowRight");
    expect(harness.focused.at(-1)).toBe("Session 3");

    // At the page edge the arrow turns the page and lands on what came into
    // view — the cards it was walking have just unmounted, so focus would
    // otherwise fall to the document.
    press(third, "ArrowRight");
    expect(harness.cardTitles()).toEqual(["Session 4", "Session 5", "Session 6"]);
    expect(harness.focused.at(-1)).toBe("Session 4");
  });

  test("arrowing back off the first card lands on the last card of the previous page", () => {
    click(harness.pagerButton("More sessions"));
    press(harness.cards()[0], "ArrowLeft");
    expect(harness.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);
    expect(harness.focused.at(-1)).toBe("Session 3");
  });

  test("Home and End jump to the ends and focus the card that arrives", () => {
    press(harness.cards()[0], "End");
    expect(harness.cardTitles()).toEqual(["Session 7", "Session 8", "Session 9"]);
    expect(harness.focused.at(-1)).toBe("Session 9");

    press(harness.cards()[2], "Home");
    expect(harness.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);
    expect(harness.focused.at(-1)).toBe("Session 1");
  });

  test("arrow keys at the very ends of the list do not move the page", () => {
    press(harness.cards()[0], "ArrowLeft");
    expect(harness.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);

    press(harness.cards()[0], "End");
    press(harness.cards()[2], "ArrowRight");
    expect(harness.cardTitles()).toEqual(["Session 7", "Session 8", "Session 9"]);
  });

  test("a pager button that its own click disables hands focus to its sibling", () => {
    click(harness.pagerButton("More sessions"));
    click(harness.pagerButton("More sessions"));
    expect(harness.pagerButton("More sessions").props.disabled).toBe(true);
    expect(harness.focused.at(-1)).toBe("Previous sessions");

    click(harness.pagerButton("Previous sessions"));
    click(harness.pagerButton("Previous sessions"));
    expect(harness.pagerButton("Previous sessions").props.disabled).toBe(true);
    expect(harness.focused.at(-1)).toBe("More sessions");
  });

  test("resuming still calls the session handler with its familiar", () => {
    const onOpenSession = vi.fn();
    const local = mount(seed(9), onOpenSession);
    click(local.cards()[1]);
    expect(onOpenSession).toHaveBeenCalledWith("s-2", "nova");
  });

  test("no pager when everything already fits on one page", () => {
    const local = mount(seed(3));
    expect(local.cardTitles()).toEqual(["Session 1", "Session 2", "Session 3"]);
    expect(local.pagerButton("More sessions")).toBe(null);
    expect(local.pagerButton("Previous sessions")).toBe(null);
  });

  test("a list that shrinks under the reader clamps to the last real page", () => {
    press(harness.cards()[0], "End");
    expect(harness.cardTitles()).toEqual(["Session 7", "Session 8", "Session 9"]);
    harness.update(seed(4));
    expect(harness.cardTitles()).toEqual(["Session 4"]);
    expect(harness.deckLabel()).toBe("Session 4 of 4");
  });

  test("archived, generated and untitled sessions are not paged through", () => {
    const local = mount(
      seed(9, [
        {},
        { archived_at: iso(1) },
        { generated: true },
        { title: "   " },
      ]),
    );
    expect(local.deckLabel()).toBe("Sessions 1 to 3 of 6");
    expect(local.cardTitles()).toEqual(["Session 1", "Session 5", "Session 6"]);
  });
});
