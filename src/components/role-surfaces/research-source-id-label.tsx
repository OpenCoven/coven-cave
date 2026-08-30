type ResearchSourceIdLabelProps = {
  id: string;
  className?: string;
};

const COMPACT_SOURCE_ID_LENGTH = 5;

export function compactResearchSourceId(id: string): string {
  if (id.length <= COMPACT_SOURCE_ID_LENGTH) return id;
  return `${id.slice(0, 2)}…${id.slice(-2)}`;
}

export function ResearchSourceIdLabel({
  id,
  className,
}: ResearchSourceIdLabelProps) {
  const classes = ["research-source-id-label", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      title={id}
      data-research-source-id-label={id}
      aria-hidden
    >
      {compactResearchSourceId(id)}
    </span>
  );
}
