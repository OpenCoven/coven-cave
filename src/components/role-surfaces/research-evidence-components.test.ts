// @ts-nocheck — react-test-renderer ships no types; this is a rendered component behavior test.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";
import {
  parseInline,
  type FindingsSupportTarget,
} from "@/lib/research-findings-doc";
import type { ResearchSourceRef } from "@/lib/research-missions";
import { ResearchEvidenceInspector } from "./research-evidence-inspector";
import {
  ResearchProvenanceEdge,
  type ResearchProvenanceTone,
} from "./research-provenance-edge";
import {
  compactResearchSourceId,
  ResearchSourceIdLabel,
} from "./research-source-id-label";
import { ResearchFindingsInlineSpans } from "./research-reader";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const callbacks = {
  onToggle: () => {},
  onOpenUrl: () => {},
  onCite: () => {},
  onSupport: () => {},
  onClose: () => {},
  onRetrySources: () => {},
  ledgerState: "available" as const,
  retryingSources: false,
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
      /<button[^>]*aria-label="Open evidence S1"[^>]*>[\s\S]*?<span[^>]*class="[^"]*research-provenance-edge__anchor[^"]*"[^>]*>[\s\S]*?S1[\s\S]*?<\/span>[\s\S]*?<\/button>/,
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

  test("compacts long visual ids while retaining the complete accessible identity", () => {
    const id = `manual-${"source-".repeat(14)}primary`;
    const html = renderToStaticMarkup(
      createElement(ResearchProvenanceEdge, {
        ids: [id],
        selectedId: null,
        toneForId: (): ResearchProvenanceTone => "accent",
        onPreview: () => {},
        onSelect: () => {},
      }),
    );

    assert.equal(compactResearchSourceId("S123"), "S123");
    assert.equal(compactResearchSourceId("R4"), "R4");
    assert.equal(compactResearchSourceId("C27"), "C27");
    assert.notEqual(compactResearchSourceId(id), id);
    assert.match(html, new RegExp(`aria-label="Open evidence ${id}"`));
    assert.match(html, new RegExp(`title="${id}"`));
    assert.match(html, new RegExp(`data-research-source-id-label="${id}"`));
    assert.doesNotMatch(
      html,
      new RegExp(
        `<span[^>]*class="[^"]*research-provenance-edge__anchor[^"]*"[^>]*>${id}</span>`,
      ),
    );
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

  test("failed ledgers render a retry treatment without stale source cards", async () => {
    const onRetrySources = vi.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        createElement(ResearchEvidenceInspector, {
          ...callbacks,
          sources: [],
          ledgerState: "failed",
          retryingSources: false,
          integrityLabel: "Sources unavailable — references can't be verified",
          selectedId: null,
          openIds: new Set<string>(),
          targetsBySource: new Map<string, FindingsSupportTarget[]>(),
          onRetrySources,
        }),
      );
    });

    expect(renderer.root.findAllByProps({ "data-source-id": "S1" })).toHaveLength(0);
    expect(
      renderer.root.find(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("research-evidence-inspector__failure"),
      ),
    ).toBeTruthy();
    const retry = renderer.root.findByProps({ children: "Retry sources" });
    retry.props.onClick();
    expect(onRetrySources).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  test("source id label preserves full tooltip and data identity", () => {
    const id = `manual-${"x".repeat(96)}`;
    const html = renderToStaticMarkup(
      createElement(ResearchSourceIdLabel, {
        id,
        className: "test-source-label",
      }),
    );

    assert.match(html, new RegExp(`title="${id}"`));
    assert.match(html, /aria-hidden="true"/);
    assert.match(
      html,
      /class="research-source-id-label test-source-label"/,
    );
    assert.doesNotMatch(html, new RegExp(`>${id}</span>`));
  });
});

describe("ResearchFindingsInlineSpans", () => {
  test("keeps authored refs as aria-hidden visual text beside the sole interactive inline control", () => {
    const longId = `manual-${"source-".repeat(14)}primary`;
    const sources = [
      source("S1", "used"),
      source("C1", "conflicting"),
      source("R1", "rejected"),
      source(longId, "used"),
    ];
    const html = renderToStaticMarkup(
      createElement(ResearchFindingsInlineSpans, {
        spans: parseInline(
          `S1 contradicts C1; R1 is rejected; [S99] is missing; ${longId} remains.`,
          sources,
        ),
        keyPrefix: "authored-refs",
        sourceById: new Map(sources.map((item) => [item.id, item])),
        hoverKey: null,
        selectedSourceId: null,
        onRefPreview: () => {},
        onClearPreview: () => {},
        onRefClick: () => {},
      }),
    );

    for (const [id, tone] of [
      ["S1", "accent"],
      ["C1", "warn"],
      ["R1", "muted"],
      ["S99", "unresolved"],
      [longId, "accent"],
    ] as const) {
      assert.equal(
        html.match(new RegExp(`data-research-reference-id="${id}"`, "g"))
          ?.length,
        1,
        `${id} has one interactive representation`,
      );
      assert.match(
        html,
        new RegExp(
          `<span[^>]*class="rr-wide-ref rr-wide-ref--${tone}"[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?data-research-source-id-label="${id}"`,
        ),
        `${id} has a noninteractive wide visual token`,
      );
    }
    assert.match(html, new RegExp(`title="${longId}"`));
    assert.doesNotMatch(
      html,
      /<button[^>]*rr-wide-ref|<span[^>]*rr-wide-ref[^>]*(?:tabindex|role)=/,
    );
  });

  test("renders mixed link labels as linked prose plus selectable evidence refs", () => {
    const sources = [
      source("S1", "used"),
      source("S14", "candidate"),
    ];
    const html = renderToStaticMarkup(
      createElement(ResearchFindingsInlineSpans, {
        spans: parseInline(
          "[S1](../sources.json), [evidence S14](https://example.com/report), and [paper](https://example.com/plain).",
          sources,
        ),
        keyPrefix: "linked-citations",
        sourceById: new Map(sources.map((item) => [item.id, item])),
        hoverKey: null,
        selectedSourceId: null,
        onRefPreview: () => {},
        onClearPreview: () => {},
        onRefClick: () => {},
      }),
    );

    assert.match(html, /<button[^>]*aria-label="Open evidence S1"/);
    assert.match(html, /<button[^>]*aria-label="Open evidence S14"/);
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/report"[^>]*>evidence <\/a>/,
    );
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/plain"[^>]*>paper<\/a>/,
    );
    assert.doesNotMatch(html, /<a[^>]*>S(?:1|14)<\/a>/);
  });
});
