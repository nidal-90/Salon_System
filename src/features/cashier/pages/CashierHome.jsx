import Page from "../../../components/ui/Page";
import TopBar from "../../../components/common/TopBar";
import styles from "./CashierHome.module.css";

export default function CashierHome({ session, onLogout }) {
  return (
    <Page
      title="Kasse"
      subtitle="Nur Cash-USB darf abkassieren."
      right={null}
    >
      <TopBar session={session} onLogout={onLogout} onLoadKeyClick={() => {}} />
      <div className={styles.card}>
        <div className={styles.hint}>
          Nächster Schritt: Checkout UI + Tagesabschluss (ohne Historie; nur heute).
        </div>
      </div>
    </Page>
  );
}
