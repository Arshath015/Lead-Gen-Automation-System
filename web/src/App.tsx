import { useEffect, useState } from "react";
import { ToastProvider } from "./lib/toast";
import { TooltipProvider } from "./components/ui/Tooltip";
import { AppShell, type View } from "./components/AppShell";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { LeadsPage } from "./features/leads/LeadsPage";
import { IcpProfilesPage } from "./features/icp/IcpProfilesPage";
import { ImportPage } from "./features/import/ImportPage";
import { CrmView } from "./features/crm/CrmView";
import { SettingsPage } from "./features/settings/SettingsPage";

const VALID_VIEWS: View[] = ["dashboard", "leads", "icp", "import", "crm", "settings"];

// Reads the current view from the URL hash (e.g. "#/leads") so a full page
// reload stays on the same screen instead of always resetting to Dashboard —
// with no routing at all, refreshing while on Settings looked like every
// toggle on that page had silently lost its state.
function viewFromHash(): View {
  const key = location.hash.replace(/^#\/?/, "");
  return (VALID_VIEWS as string[]).includes(key) ? (key as View) : "dashboard";
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  // Once the CRM tab has been opened, keep its iframe mounted (just hidden)
  // instead of unmounting on every switch away — the CRM has its own login
  // session and internal navigation state that would otherwise reset (and
  // re-prompt for login) every single time you switch back to it.
  const [crmEverOpened, setCrmEverOpened] = useState(view === "crm");

  useEffect(() => {
    if (view === "crm") setCrmEverOpened(true);
  }, [view]);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(next: View) {
    location.hash = `/${next}`;
    setView(next);
  }

  return (
    <ToastProvider>
      <TooltipProvider>
        <AppShell view={view} onNavigate={navigate}>
          {view === "dashboard" && <DashboardPage />}
          {view === "leads" && <LeadsPage />}
          {view === "icp" && <IcpProfilesPage />}
          {view === "import" && <ImportPage />}
          {crmEverOpened && (
            <div className={view === "crm" ? "flex flex-1 flex-col" : "hidden"}>
              <CrmView />
            </div>
          )}
          {view === "settings" && <SettingsPage />}
        </AppShell>
      </TooltipProvider>
    </ToastProvider>
  );
}
