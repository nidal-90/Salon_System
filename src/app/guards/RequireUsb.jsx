import { Navigate } from "react-router-dom";
import useUsbSession from "../../hooks/useUsbSession.js";
import styles from "./RequireUsb.module.css";

export default function RequireUsb({ children }) {
  const { usbPresent } = useUsbSession();
  if (!usbPresent) return <Navigate to="/kiosk" replace />;
  return <div className={styles.wrap}>{children}</div>;
}
