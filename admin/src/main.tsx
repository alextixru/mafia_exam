import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { LoginGate } from "./components/LoginGate.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LoginGate>{(user) => <App user={user} />}</LoginGate>
  </StrictMode>,
);
