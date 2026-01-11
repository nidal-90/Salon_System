import styles from "./Modal.module.css";

export default function Modal({ open, title, children, onClose, footer }) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>{title}</div>
            <div className={styles.sub}>Sibel Atelier · Control</div>
          </div>
          <button className={styles.x} onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        <div className={styles.body}>{children}</div>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
