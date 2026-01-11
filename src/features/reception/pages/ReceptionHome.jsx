import { useMemo, useRef, useState } from "react";
import Page from "../../../components/ui/Page";
import TopBar from "../../../components/common/TopBar";
import styles from "./ReceptionHome.module.css";
import GuestProfileForm from "./GuestProfileForm";
import { ROLES } from "../../../app/config/constants";

export default function ReceptionHome({ session, onLogout, onLoadKey }) {
  const [mode, setMode] = useState("guest"); // guest | area
  const fileRef = useRef(null);

  const right = useMemo(() => {
    return (
      <div className={styles.switchRow}>
        <button className={styles.smallBtn} onClick={() => setMode("guest")}>
          Kunde Profil
        </button>
        <button className={styles.smallBtn} onClick={() => setMode("area")}>
          Bereich Übersicht
        </button>
      </div>
    );
  }, []);

  const handleLoadKeyClick = () => fileRef.current?.click();

  return (
    <Page
      title="Reception / Guest"
      subtitle="Ohne USB: Kunde kann Profil erstellen/ändern. Nach Fertig wird gesperrt."
      right={right}
    >
      <TopBar session={session} onLogout={onLogout} onLoadKeyClick={handleLoadKeyClick} />

      <input
        ref={fileRef}
        type="file"
        accept=".json,.key,application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await onLoadKey(f);
          e.target.value = "";
        }}
      />

      {mode === "guest" ? (
        <div className={styles.card}>
          <GuestProfileForm
            onDone={() => {
              // Nach "Fertig" sofort sperren (Session wird guest bleiben, aber UI gesperrt)
              onLogout();
            }}
            disabled={session?.role && session.role !== ROLES.GUEST}
          />
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.hint}>
            Bereich-Übersicht kommt als nächstes: zeigt Kunden pro Bereich + wer bedient.
            Ohne USB: nur Anzeige/Navigation.
          </div>
        </div>
      )}
    </Page>
  );
}
