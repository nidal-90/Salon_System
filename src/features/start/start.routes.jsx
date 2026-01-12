// src/features/start/start.routes.jsx
import StartPage from "./pages/StartPage.jsx";
import KeyLoadPage from "../auth/pages/KeyLoadPage.jsx";
import RegisterPage from "../registration/pages/RegisterPage.jsx";

export function startRoutes() {
  return [
    { path: "/start", element: <StartPage /> },
    { path: "/login", element: <KeyLoadPage /> },
    { path: "/register", element: <RegisterPage /> },
  ];
}
