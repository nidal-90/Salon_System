import styles from "./Page.module.css";

export default function Page({ title, subtitle, right, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <div>
          <div className={styles.title}>{title}</div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </div>
        <div className={styles.right}>{right}</div>
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
