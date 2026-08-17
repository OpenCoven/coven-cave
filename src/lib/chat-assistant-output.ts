export type MeaningfulAssistantOutputInput = {
  visibleProse: string;
  hasRichBlocks?: boolean;
  resultCount?: number;
  attachmentCount?: number;
  skillUpdateCount?: number;
  hasAutoStatusUpdate?: boolean;
  editCardCount?: number;
  responseModelStatusCount?: number;
  responseControlStatusCount?: number;
  followUpCount?: number;
  hasAttentionRequest?: boolean;
};

export function hasMeaningfulAssistantOutput(input: MeaningfulAssistantOutputInput): boolean {
  if (input.visibleProse.trim().length > 0) return true;
  return Boolean(
    input.hasRichBlocks
      || (input.resultCount ?? 0) > 0
      || (input.attachmentCount ?? 0) > 0
      || (input.skillUpdateCount ?? 0) > 0
      || input.hasAutoStatusUpdate
      || (input.editCardCount ?? 0) > 0
      || (input.responseModelStatusCount ?? 0) > 0
      || (input.responseControlStatusCount ?? 0) > 0
      || (input.followUpCount ?? 0) > 0
      || input.hasAttentionRequest,
  );
}

export function shouldUseEmptySuccessfulFallback(
  input: MeaningfulAssistantOutputInput & { emptySuccessful: boolean },
): boolean {
  return input.emptySuccessful && !hasMeaningfulAssistantOutput(input);
}
