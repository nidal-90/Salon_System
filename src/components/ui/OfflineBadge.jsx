import useNetworkStatus from "../../hooks/useNetworkStatus.js";
import styles from "./OfflineBadge.module.css";

export default function OfflineBadge() {
  const { online } = useNetworkStatus();
  if (online) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.badge}>
        Offline Mode – Arbeiten möglich, Sync später.
      </div>
    </div>
  );
}
