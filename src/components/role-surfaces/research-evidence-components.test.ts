// @ts-nocheck — react-test-renderer ships no types; this is a rendered component behavior test.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";
import type { FindingsSupportTarget } from "@/lib/research-findings-doc";
import type { ResearchSourceRef } from "@/lib/research-missions";
import { ResearchEvidenceInspector } from "./research-evidence-inspector";
import {
  ResearchProvenanceEdge,
  type ResearchProvenanceTone,
} from "./research-provenance-edge";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const callbacks = {
  onToggle: () => {},
  onOpenUrl: () => {},
  onCite: () => {},
  onSupport: () => {},
  onClose: () => {},
};

function source(
  id: string,
  status: ResearchSourceRef["status"],
  title = `${id} source`,
): ResearchSourceRef {
  return {
    id,
    title,
    sourceType: "web",
    status,
  };
}

function buttonTag(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>`))?.[0] ?? "";
}

describe("ResearchProvenanceEdge", () => {
  test("passes the invoking control through evidence selection", async () => {
    const onSelect = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ResearchProvenanceEdge, {
          ids: ["S1"],
          selectedId: null,
          toneForId: (): ResearchProvenanceTone => "accent",
          onPreview: () => {},
          onSelect,
        }),
      );
    });
    const button = renderer.root.findByType("button");
    const element = { focus: vi.fn() };

    button.props.onClick({ currentTarget: element });

    expect(onSelect).toHaveBeenCalledWith("S1", element);
    await act(async () => renderer.unmount());
  });

  test("keeps preview active until both hover and focus leave", async () => {
    const onPreview = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ResearchProvenanceEdge, {
          ids: ["S1"],
          selectedId: null,
          toneForId: (): ResearchProvenanceTone => "accent",
          onPreview,
          onSelect: () => {},
        }),
      );
    });
    const button = renderer.root.findByType("button");
    const element = {
      closest: () => ({ querySelectorAll: () => [element] }),
      tabIndex: 0,
    };

    button.props.onFocus({ currentTarget: element });
    button.props.onMouseEnter({ currentTarget: element });
    button.props.onMouseLeave({ currentTarget: element });
    button.props.onBlur({ currentTarget: element });

    expect(onPreview.mock.calls.map(([id]) => id)).toEqual([
      "S1",
      "S1",
      "S1",
      null,
    ]);
    expect(onPreview).toHaveBeenNthCalledWith(3, "S1", element);

    onPreview.mockClear();
    button.props.onMouseEnter({ currentTarget: element });
    button.props.onFocus({ currentTarget: element });
    button.props.onBlur({ currentTarget: element });
    button.props.onMouseLeave({ currentTarget: element });

    expect(onPreview.mock.calls.map(([id]) => id)).toEqual([
      "S1",
      "S1",
      "S1",
      null,
    ]);
    expect(onPreview).toHaveBeenNthCalledWith(3, "S1", element);

    await act(async () => renderer.unmount());
  });

  test("committing a selection clears hover and focus preview state", async () => {
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ResearchProvenanceEdge, {
          ids: ["S1"],
          selectedId: null,
          toneForId: (): ResearchProvenanceTone => "accent",
          onPreview,
          onSelect,
        }),
      );
    });
    const button = renderer.root.findByType("button");
    const element = {
      closest: () => ({ querySelectorAll: () => [element] }),
      tabIndex: 0,
    };

    button.props.onFocus({ currentTarget: element });
    button.props.onMouseEnter({ currentTarget: element });
    button.props.onClick({ currentTarget: element });
    button.props.onMouseLeave({ currentTarget: element });
    button.props.onBlur({ currentTarget: element });

    expect(onSelect).toHaveBeenCalledWith("S1", element);
    expect(onPreview.mock.calls.map(([id]) => id)).toEqual([
      "S1",
      "S1",
      null,
      null,
      null,
    ]);
    await act(async () => renderer.unmount());
  });

  test("exposes a labeled provenance landmark without changing its controls", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchProvenanceEdge, {
        ids: ["S1", "C1"],
        selectedId: null,
        toneForId: (id): ResearchProvenanceTone =>
          id === "C1" ? "muted" : "accent",
        onPreview: () => {},
        onSelect: () => {},
      }),
    );

    assert.match(
      html,
      /<div[^>]*class="research-provenance-edge"[^>]*role="region"[^>]*aria-label="Evidence references · 2"/,
    );
    assert.doesNotMatch(html, /role="group"/);
    assert.match(html, /aria-label="Open evidence S1"/);
    assert.match(html, /aria-label="Open conflict C1"/);
    assert.match(
      buttonTag(html, "Open evidence S1"),
      /research-provenance-edge__item/,
    );
    assert.match(
      html,
      /<button[^>]*aria-label="Open evidence S1"[^>]*>[\s\S]*?<span class="research-provenance-edge__anchor">S1<\/span>[\s\S]*?<\/button>/,
      "the focusable hit target wraps a smaller painted provenance anchor",
    );
    assert.match(
      buttonTag(html, "Open evidence S1"),
      /data-research-reference-id="S1"/,
      "every margin representation exposes the stable reference id used for responsive focus restoration",
    );
    assert.match(
      buttonTag(html, "Open evidence S1"),
      /data-research-reference-representation="edge"/,
    );
    assert.match(buttonTag(html, "Open conflict C1"), /data-tone="warn"/);
    assert.equal(
      renderToStaticMarkup(
        createElement(ResearchProvenanceEdge, {
          ids: [],
          selectedId: null,
          toneForId: (): ResearchProvenanceTone => "accent",
          onPreview: () => {},
          onSelect: () => {},
        }),
      ),
      "",
    );
  });

  test("keeps arrow-key roving focus inside the provenance region", async () => {
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ResearchProvenanceEdge, {
          ids: ["S1", "S2"],
          selectedId: null,
          toneForId: (): ResearchProvenanceTone => "accent",
          onPreview: () => {},
          onSelect: () => {},
        }),
      );
    });
    const buttons = renderer.root.findAllByType("button");
    const focused: string[] = [];
    const elements = buttons.map((button, index) => ({
      focus: () => focused.push(button.props["data-research-provenance-id"]),
      tabIndex: index === 0 ? 0 : -1,
    }));
    const region = { querySelectorAll: () => elements };

    buttons[0].props.onKeyDown({
      key: "ArrowRight",
      currentTarget: {
        closest: (selector: string) =>
          selector === ".research-provenance-edge" ? region : null,
      },
      preventDefault: () => {},
    });

    expect(focused).toEqual(["S2"]);
    await act(async () => renderer.unmount());
  });

  test("labels unresolved source controls truthfully without inventing evidence", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchProvenanceEdge, {
        ids: ["S99"],
        selectedId: null,
        toneForId: (): ResearchProvenanceTone => "unresolved",
        onPreview: () => {},
        onSelect: () => {},
      }),
    );

    assert.match(html, /aria-label="Missing source S99"/);
    assert.match(buttonTag(html, "Missing source S99"), /data-tone="unresolved"/);
    assert.doesNotMatch(html, /Open evidence S99/);
  });

  test("uses the selected control as the roving tab stop", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchProvenanceEdge, {
        ids: ["S1", "S2", "C1"],
        selectedId: "S2",
        toneForId: (): ResearchProvenanceTone => "accent",
        onPreview: () => {},
        onSelect: () => {},
      }),
    );

    assert.match(buttonTag(html, "Open evidence S1"), /tabindex="-1"/);
    assert.match(buttonTag(html, "Open evidence S2"), /tabindex="0"/);
    assert.match(buttonTag(html, "Open evidence S2"), /aria-current="true"/);
    assert.match(buttonTag(html, "Open conflict C1"), /tabindex="-1"/);
  });
});

describe("ResearchEvidenceInspector", () => {
  test("renders a sparse candidate source as a full card", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchEvidenceInspector, {
        sources: [source("S2", "candidate", "Sparse source")],
        integrityLabel: "1 source awaits review",
        selectedId: "S2",
        openIds: new Set(["S2"]),
        targetsBySource: new Map<string, FindingsSupportTarget[]>(),
        ...callbacks,
      }),
    );

    assert.match(html, /<article[^>]*research-evidence-card/);
    assert.match(html, /Sparse source/);
    assert.match(html, /Candidate/);
    assert.match(html, />Type</);
    assert.match(html, />web</);
  });

  test("groups every status by priority and preserves mission order within groups", () => {
    const sources = [
      source("S6", "rejected", "Rejected first in mission"),
      source("S2", "used", "Used first"),
      source("S4", "candidate", "Candidate first"),
      source("S1", "used", "Used second"),
      source("C1", "conflicting", "Conflict"),
      source("S5", "candidate", "Candidate second"),
    ];
    const html = renderToStaticMarkup(
      createElement(ResearchEvidenceInspector, {
        sources,
        integrityLabel: "1 conflict remains",
        selectedId: null,
        openIds: new Set<string>(),
        targetsBySource: new Map<string, FindingsSupportTarget[]>(),
        ...callbacks,
      }),
    );

    const orderedTitles = [
      "Used first",
      "Used second",
      "Candidate first",
      "Candidate second",
      "Conflict",
      "Rejected first in mission",
    ];
    let previousIndex = -1;
    for (const title of orderedTitles) {
      const index = html.indexOf(title);
      assert.ok(index > previousIndex, `${title} should follow the preceding priority item`);
      previousIndex = index;
    }
  });

  test("shows source count, integrity, and an accessible close control", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchEvidenceInspector, {
        sources: [source("S1", "used"), source("S2", "candidate")],
        integrityLabel: "1 source awaits review",
        selectedId: null,
        openIds: new Set<string>(),
        targetsBySource: new Map<string, FindingsSupportTarget[]>(),
        ...callbacks,
      }),
    );

    assert.match(html, /2 sources/);
    assert.match(html, /1 source awaits review/);
    assert.match(html, /aria-label="Close evidence inspector"/);
    assert.match(buttonTag(html, "Close evidence inspector"), /focus-ring/);
  });

  test("renders only real support targets and the existing source actions", () => {
    const richSource: ResearchSourceRef = {
      id: "S1",
      title: "Primary source",
      sourceType: "journal",
      status: "used",
      url: "https://example.com/report",
      publisher: "Example Journal",
      publishedAt: "2026-08-01",
      claim: "Observed result",
      note: "Primary evidence",
      confidence: 0.82,
    };
    const target: FindingsSupportTarget = {
      id: "findings-overview-block-1",
      label: "Overview",
      sectionId: "overview",
    };
    const html = renderToStaticMarkup(
      createElement(ResearchEvidenceInspector, {
        sources: [richSource, source("S2", "candidate", "No linked evidence")],
        integrityLabel: "1 source verified",
        selectedId: "S1",
        openIds: new Set(["S1", "S2"]),
        targetsBySource: new Map([["S1", [target]]]),
        ...callbacks,
      }),
    );

    assert.match(html, /Observed result/);
    assert.match(html, /Example Journal/);
    assert.match(html, /2026-08-01/);
    assert.match(html, /Primary evidence/);
    assert.match(html, /82%/);
    assert.match(html, />Overview</);
    assert.equal((html.match(/>Open source</g) ?? []).length, 2);
    assert.equal((html.match(/>Cite</g) ?? []).length, 2);
    assert.equal((html.match(/rr-sd-supportlink/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Accept source|Reject source|Generated summary/);
  });
});
