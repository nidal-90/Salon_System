import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import styles from "./KioskGroupPage.module.css";

export default function KioskGroupPage() {
  const nav = useNavigate();
  const step1 = JSON.parse(sessionStorage.getItem("kiosk_payload_step1") || "{}");

  const [isGroup, setIsGroup] = useState(false);
  const [members, setMembers] = useState([{ displayName: step1.displayName || "Kunde", phone: "" }]);
  const [preferredPaymentMode, setPreferredPaymentMode] = useState("single"); // single|split

  const canNext = useMemo(() => {
    if (!isGroup) return true;
    return members.every((m) => (m.displayName || "").trim().length >= 2);
  }, [isGroup, members]);

  function addMember() {
    setMembers((p) => [...p, { displayName: "", phone: "" }]);
  }

  function updateMember(i, patch) {
    setMembers((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function removeMember(i) {
    setMembers((p) => p.filter((_, idx) => idx !== i));
  }

  function next() {
    const payload = {
      ...step1,
      preferredPaymentMode,
      members: isGroup ? members : null,
    };
    sessionStorage.setItem("kiosk_payload_step2", JSON.stringify(payload));
    nav("/kiosk/products");
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Einzelkunde oder Gruppe</h2>
          <p className={styles.sub}>Für Hochzeit/Gruppe: Mitglieder hinzufügen.</p>
        </div>

        <div className={styles.row}>
          <label className={styles.check}>
            <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} />
            <span>Gruppe (z. B. Hochzeit)</span>
          </label>

          <div className={styles.pills}>
            <button
              className={`${styles.pill} ${preferredPaymentMode === "single" ? styles.on : ""}`}
              onClick={() => setPreferredPaymentMode("single")}
              type="button"
            >
              Zusammen zahlen
            </button>
            <button
              className={`${styles.pill} ${preferredPaymentMode === "split" ? styles.on : ""}`}
              onClick={() => setPreferredPaymentMode("split")}
              type="button"
            >
              Separat zahlen
            </button>
          </div>
        </div>

        {isGroup && (
          <div className={styles.members}>
            <div className={styles.membersHead}>
              <div className={styles.bold}>Mitglieder</div>
              <button className={styles.add} onClick={addMember} type="button">
                + Mitglied
              </button>
            </div>

            {members.map((m, i) => (
              <div key={i} className={styles.memberRow}>
                <input
                  className={styles.input}
                  value={m.displayName}
                  placeholder={i === 0 ? "Braut (Name)" : "Name"}
                  onChange={(e) => updateMember(i, { displayName: e.target.value })}
                />
                <input
                  className={styles.input}
                  value={m.phone}
                  placeholder="Telefon (optional)"
                  onChange={(e) => updateMember(i, { phone: e.target.value })}
                />
                {i > 0 && (
                  <button className={styles.remove} onClick={() => removeMember(i)} type="button">
                    Entfernen
                  </button>
                )}
              </div>
            ))}

            <div className={styles.note}>
              Hinweis: Profile für Mitglieder können später als Admin/Rezeption nachgetragen werden (Step-2 Ausbau).
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.secondary} onClick={() => nav("/kiosk/services")} type="button">
            Zurück
          </button>
          <button className={styles.primary} onClick={next} disabled={!canNext} type="button">
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}
