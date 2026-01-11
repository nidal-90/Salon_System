import { useEffect } from "react";
import useNetworkStatus from "../../hooks/useNetworkStatus.js";
import useUsbSession from "../../hooks/useUsbSession.js";
import styles from "./AppProviders.module.css";
import { initDb } from "../../db/index.js";

export default function AppProviders({ children }) {
  useNetworkStatus();
  useUsbSession();

  useEffect(() => {
    initDb().catch(console.error);
  }, []);

  return <div className={styles.wrap}>{children}</div>;
}
