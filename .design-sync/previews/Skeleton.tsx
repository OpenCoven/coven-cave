import { Skeleton, SkeletonGroup, SkeletonRows } from "coven-cave";

function Surface({ children, column }: { children: React.ReactNode; column?: boolean }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: column ? "column" : "row",
        alignItems: column ? "stretch" : "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export const TextVariants = () => (
  <Surface column>
    <Skeleton variant="text" width="70%" />
    <Skeleton variant="text" width="45%" />
    <Skeleton variant="text-sm" width="55%" />
    <Skeleton variant="text-sm" width="30%" />
  </Surface>
);

export const AvatarAndCard = () => (
  <Surface>
    <Skeleton variant="avatar" />
    <Skeleton variant="card" width={180} height={90} />
    <Skeleton variant="card" width={180} height={90} />
  </Surface>
);

export const LoadingSessionList = () => (
  <Surface column>
    <SkeletonRows count={4} />
  </Surface>
);

export const FamiliarProfileLoading = () => (
  <Surface>
    <Skeleton variant="avatar" />
    <SkeletonGroup>
      <Skeleton variant="text" width={160} />
      <Skeleton variant="text-sm" width={220} />
      <Skeleton variant="text-sm" width={120} />
    </SkeletonGroup>
  </Surface>
);
