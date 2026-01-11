import Page from "../../../components/ui/Page";
import TopBar from "../../../components/common/TopBar";
import styles from "./StaffHome.module.css";

export default function StaffHome({ session, onLogout, onLoadKey }) {
  return (
    <Page
      title="Mitarbeiter"
      subtitle="USB Staff: bedienen/Services buchen. Keine Kasse."
      right={null}
    >
      <TopBar session={session} onLogout={onLogout} onLoadKeyClick={() => {}} />
      <div className={styles.card}>
        <div className={styles.hint}>
          Nächster Schritt: Bereich wählen → Kundenliste → Service buchen (Start/Stop) → Tageszählung.
        </div>
      </div>
    </Page>
  );
}
