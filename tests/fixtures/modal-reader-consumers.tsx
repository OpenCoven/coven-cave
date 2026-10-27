import type { ReactNode } from "react";
import { DayModals } from "@/components/daily-report-modals";
import { CodeReadingInspector } from "@/components/code-reading-inspector";
import { AttachmentList } from "@/components/chat-attachment-cards";
import { ChatArtifactViewer } from "@/components/chat-artifact-viewer";
import { buildDayModel } from "@/lib/daily-report-day";
import { breakdownForDay } from "@/lib/daily-report";

const day = new Date(2026, 9, 24, 12);
const model = buildDayModel({
  stats: { reminders: 0, responses: 0, familiars: 0, sessions: 8, prsMerged: 8 },
  payload: {
    prsMerged: Array.from({ length: 8 }, (_, index) => ({
      repo: "fixture/review",
      number: index + 1,
      title: `Review project dependencies and preserve authored decisions ${index + 1}`,
      url: `https://example.test/review/${index + 1}`,
      mergedAt: new Date(2026, 9, 24, index * 2).toISOString(),
    })),
    sessionGroups: [],
    factsHash: "synthetic-modal-review",
    refreshedAt: day.toISOString(),
  },
  breakdown: breakdownForDay([], day),
  recent: [],
  day,
  now: day,
  items: [],
});

const noop = () => {};

export function modalReaderFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "attachment-markdown": <AttachmentList attachments={[{ name: "review.md", size: 4096, text: "# Project review\n\n" + Array.from({ length: 16 }, (_, i) => `## Dependency ${i + 1}\n\nPreserve authored decisions and record unresolved dependencies.\n\n`).join("") }]} />,
    "attachment-text": <AttachmentList attachments={[{ name: "review.txt", size: 8192, text: "Preserve authored decisions and record unresolved dependencies.\n".repeat(80), truncated: true }]} />,
    "attachment-unavailable": <AttachmentList attachments={[{ name: "review.bin", size: 8192 }]} />,
    "artifact-fullscreen": <ChatArtifactViewer kind="html" initialCode="<!doctype html><html><body><h1>Project review</h1><p>Synthetic artifact preview.</p></body></html>" title="Project review and unresolved dependencies" familiarId="fixture" />,
    "report-chapters-populated": <DayModals modal="chapters" model={model} dateLabel="October 24, 2026" narrativeByline="Prepared from synthetic project facts for layout verification" onClose={onClose} />,
    "code-inspector": <CodeReadingInspector
      target={{ code: "export const dependency = 'preserve authored decisions';\n".repeat(60), lang: "ts", path: null, provenance: "quoted", tab: "snippet" }}
      projectRoot={null}
      pin="overlay"
      onPinChange={noop}
      onClose={onClose}
      onQuote={noop}
    />,
  };
}
