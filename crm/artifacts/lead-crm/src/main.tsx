import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { AuthProvider } from "@workspace/replit-auth-web";
import { ThemeProvider } from "@/context/theme-context";
import App from "./App";
import "./index.css";

if (import.meta.env.DEV) {
  setAuthTokenGetter(() => sessionStorage.getItem("__dev_sid"));
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ThemeProvider>,
);
