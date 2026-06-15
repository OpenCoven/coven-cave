import type { EnvironmentInspectorData } from "./mockInspector";
import styles from "./styles.module.css";

type Props = {
  environment: EnvironmentInspectorData;
};

export function EnvironmentInspector({ environment }: Props) {
  return (
    <section className={styles.inspectorSection}>
      <h2 className={styles.sectionHeader}>
        <span>Environment</span>
        <span aria-hidden>⚙</span>
      </h2>
      <div className={styles.inspectorRow}>
        <span className={styles.rowLabel}>▣ Changes</span>
        <span className={styles.countPill}>{environment.changes}</span>
      </div>
      <div className={styles.inspectorRow}>
        <span className={styles.rowLabel}>⌘ Local</span>
        <span className={styles.monoPill}>{environment.branch}</span>
      </div>
      <div className={styles.inspectorRow}>
        <span className={styles.rowLabel}>
          <span className={styles.commitDot} aria-hidden />
          Commit
        </span>
        <span>{environment.commitState}</span>
      </div>
    </section>
  );
}
