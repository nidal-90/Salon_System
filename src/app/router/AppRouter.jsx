// src/app/router/AppRouter.jsx
import AppRoutes from "./routes.jsx";
import styles from "./AppRouter.module.css";

export default function AppRouter() {
  return (
    <div className={styles.wrap}>
      <AppRoutes />
    </div>
  );
}
