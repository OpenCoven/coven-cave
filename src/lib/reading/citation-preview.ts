export type CitationPreviewInteraction = "row-hover" | "row-focus" | "preview-hover" | "preview-focus";

export type CitationPreviewCoordinator = {
  enter: (interaction: CitationPreviewInteraction) => void;
  leave: (interaction: CitationPreviewInteraction) => void;
  dismiss: () => void;
  dispose: () => void;
};

export function createCitationPreviewCoordinator(
  onOpenChange: (open: boolean) => void,
  closeDelayMs = 180,
): CitationPreviewCoordinator {
  const activeInteractions = new Set<CitationPreviewInteraction>();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelClose = () => {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  return {
    enter(interaction) {
      activeInteractions.add(interaction);
      cancelClose();
      onOpenChange(true);
    },
    leave(interaction) {
      activeInteractions.delete(interaction);
      if (activeInteractions.size > 0) return;

      cancelClose();
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        if (activeInteractions.size === 0) onOpenChange(false);
      }, closeDelayMs);
    },
    dismiss() {
      activeInteractions.clear();
      cancelClose();
      onOpenChange(false);
    },
    dispose() {
      activeInteractions.clear();
      cancelClose();
    },
  };
}
