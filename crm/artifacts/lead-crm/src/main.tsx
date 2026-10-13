import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { AuthProvider } from "@workspace/replit-auth-web";
import { ThemeProvider } from "@/context/theme-context";
import { installDemoFetch } from "@/demo/installDemoFetch";
import App from "./App";
import "./index.css";

if (import.meta.env.DEV) {
  setAuthTokenGetter(() => sessionStorage.getItem("__dev_sid"));
}

// VITE_DEMO_MODE is set only on the rapport-crm-demo Vercel project's env
// vars — never locally or in any real deployment — so this never affects
// local dev or a real production instance.
if (import.meta.env.VITE_DEMO_MODE === "true") {
  installDemoFetch();
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ThemeProvider>,
);
