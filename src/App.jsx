// src/App.jsx
import AppProviders from "./app/providers/AppProviders.jsx";
import AppRouter from "./app/router/AppRouter.jsx";
import "./App.css";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
