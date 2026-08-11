import type {
  ResearchGeneration,
  ResearchGenerationContent,
  ResearchGenerationMediaKind,
  ResearchGenerationProgress,
  ResearchGenerationStage,
} from "../research-generations.ts";

export type MediaGenerationContent = Extract<
  ResearchGenerationContent,
  { kind: ResearchGenerationMediaKind }
>;

export type ResearchMediaJobContext = {
  reportStage: (
    stage: ResearchGenerationStage,
    progress?: ResearchGenerationProgress,
  ) => Promise<void>;
  signal: AbortSignal;
  isCancellationRequested: () => boolean;
};

export type ResearchMediaJobDefinition = {
  familiarId: string;
  generationId: string;
  run: (
    context: ResearchMediaJobContext,
  ) => Promise<{ content: MediaGenerationContent }>;
  kill?: () => void;
};

export type ResearchMediaJobFactory = (
  generation: ResearchGeneration,
) => ResearchMediaJobDefinition;

export type ResearchMediaQueueResult =
  | {
      ok: true;
      generation: ResearchGeneration;
      done: Promise<void>;
    }
  | {
      ok: false;
      code: "not-found" | "not-media" | "invalid-state" | "invalid-draft";
      error: string;
      generation?: ResearchGeneration;
    };

export type ResearchMediaCancelResult =
  | {
      ok: true;
      generation: ResearchGeneration;
    }
  | {
      ok: false;
      code: "not-found" | "invalid-state";
      error: string;
      generation?: ResearchGeneration;
    };
