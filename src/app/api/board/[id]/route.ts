import { NextResponse } from "next/server";
import {
  deleteCard,
  loadBoard,
  updateCard,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board";
import type { CardStep } from "@/lib/cave-board-types";
import type { CardAsanaLink, CardGitHubLink } from "@/lib/cave-board-types";
import type { ChatAttachment } from "@/lib/chat-attachments";
import type { CardOps, CardOpsOutcome } from "@/lib/board-card-ops";
import { trustedProjectCwd } from "@/lib/cave-projects";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Partial<{
    title: string;
    notes: string;
    status: CardStatus;
    lifecycle: CardLifecycle;
    lifecycleReason: string | undefined;
    priority: CardPriority;
    familiarId: string | null;
    modelOverride: string | null;
    modelOverrideHarness: string | null;
    sessionId: string | null;
    cwd: string | null;
    projectId: string | null;
    links: string[];
    github: CardGitHubLink[];
    asana: CardAsanaLink[];
    labels: string[];
    startDate: string | null;
    endDate: string | null;
    needsHuman: boolean;
    runningSince: string | undefined;
    steps: CardStep[];
    attachments: ChatAttachment[];
    /** Intent ops for array fields — applied against the current card under
     * the board lock so concurrent element edits don't clobber each other. */
    ops: CardOps;
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  // Keep a card's cwd consistent with its project, server-side (cave-pw83):
  //  - assigning a project (projectId set) → derive cwd from it, ignoring the body's;
  //  - changing cwd alone → re-derive from the card's CURRENT project if it has one,
  //    so a client can't point a project-assigned card at a contradictory cwd.
  // Clearing the project (projectId === null) leaves the client cwd (no project to
  // anchor to). Neither path lets a mismatched body.cwd through.
  if (body.projectId) {
    const resolved = await trustedProjectCwd(body.projectId);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: "assigned project not found" }, { status: 409 });
    }
    body = { ...body, cwd: resolved.root };
  } else if (body.cwd !== undefined && body.projectId === undefined) {
    const current = (await loadBoard()).cards.find((entry) => entry.id === id);
    if (current?.projectId) {
      const resolved = await trustedProjectCwd(current.projectId);
      if (resolved.ok) body = { ...body, cwd: resolved.root };
    }
  }
  let operationOutcome: CardOpsOutcome | undefined;
  const card = await updateCard(id, body, {
    onOperationOutcome: (outcome) => {
      operationOutcome = outcome;
    },
  });
  if (!card) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    card,
    ...(operationOutcome ? { operationOutcome } : {}),
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // A card linked to a Bead is a durable reference target. Routine cleanup gets
  // a 409 and has to unlink first; `?unlink=1` is the explicit stronger action
  // for a caller that means it. The guard lives here, not in the client, because
  // the store is the retention boundary (cave-xddxs).
  const allowLinked = new URL(req.url).searchParams.get("unlink") === "1";
  const outcome = await deleteCard(id, { allowLinked });
  if (outcome === "not-found") {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  if (outcome === "linked") {
    return NextResponse.json(
      { ok: false, error: "linked_bead_requires_unlink" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
