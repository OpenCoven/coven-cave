import styles from "./styles.module.css";

export function FollowUpComposer() {
  return (
    <div className={styles.composerWrap}>
      <form className={styles.composer} aria-label="Follow-up composer">
        <div className={styles.composerLeft}>
          <button type="button" className={styles.iconButton} aria-label="Attach file">+</button>
          <button type="button" className={styles.controlPill}>⚙ Custom⌄</button>
        </div>
        <div className={styles.composerInput} aria-hidden>
          Ask for follow-up changes
        </div>
        <div className={styles.composerRight}>
          <button type="button" className={styles.controlPill}>⚡ 5.5 High⌄</button>
          <button type="button" className={styles.iconButton} aria-label="Dictate">♩</button>
          <button type="submit" className={styles.sendButton} aria-label="Send follow-up">↑</button>
        </div>
      </form>
    </div>
  );
}
