import type { SourceData } from "./mockInspector";
import styles from "./styles.module.css";

type Props = {
  sources: SourceData[];
};

export function SourcesList({ sources }: Props) {
  return (
    <section className={styles.inspectorSection}>
      <h2 className={styles.sectionHeader}>Sources</h2>
      {sources.length === 0 ? (
        <p className={styles.emptyState}>No sources yet</p>
      ) : (
        <div className={styles.sourceRows}>
          {sources.map((source) => (
            <div className={styles.sourceRow} key={source.id}>
              <span className={styles.sourceIcon} aria-hidden>⌁</span>
              <span>{source.title}</span>
              <span>{source.time}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
