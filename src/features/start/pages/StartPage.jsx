import { useNavigate } from "react-router-dom";
import styles from "./StartPage.module.css";

export default function StartPage() {
  const nav = useNavigate();

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.logo}>S</div>
          <div>
            <h1 className={styles.title}>Willkommen im Salon</h1>
            <p className={styles.sub}>
              Bitte wählen: Login (Key laden) oder Kunden-Check-in.
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => nav("/login")} type="button">
            Login (Key laden)
          </button>

          <button className={styles.secondary} onClick={() => nav("/register")} type="button">
            Neuen Kunden registrieren
          </button>
        </div>

        <div className={styles.note}>
          Hinweis: Ohne Key ist nur Kunden-Check-in möglich. Kassieren ist gesperrt.
        </div>
      </div>
    </div>
  );
}
