import { useNavigate } from "react-router-dom";
import styles from "./KioskLockedPage.module.css";

export default function KioskLockedPage() {
  const nav = useNavigate();

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h2 className={styles.title}>Danke</h2>
        <p className={styles.sub}>Ihre Daten wurden gespeichert. Bitte geben Sie das Tablet zurück.</p>

        <button className={styles.primary} onClick={() => nav("/kiosk")} type="button">
          Neuer Check-in
        </button>

        <div className={styles.note}>
          Hinweis: In Produktion kann dieser Screen automatisch nach X Sekunden gesperrt werden.
        </div>
      </div>
    </div>
  );
}
