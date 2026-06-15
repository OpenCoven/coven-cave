import styles from "./styles.module.css";

export function RetryRow() {
  return (
    <div className={styles.retryRow}>
      <button type="button" className={styles.retryButton}>
        retry
      </button>
      <div className={styles.retryIcons} aria-hidden>
        <span>⧉</span>
        <span>↻</span>
      </div>
    </div>
  );
}
