import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/replit-auth-web";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Layout from "./components/layout";
import { ErrorBoundary } from "./components/error-boundary";
import Leads from "./pages/leads";
import LeadDetail from "./pages/leads/lead-detail";
import Reports from "./pages/reports";
import Users from "./pages/users";
import Settings from "./pages/settings";
import Audit from "./pages/audit";
import Activities from "./pages/activities";
import RolesPage from "./pages/roles";
import Contacts from "./pages/contacts";
import ContactDetail from "./pages/contacts/contact-detail";
import Accounts from "./pages/accounts";
import Deals from "./pages/deals";
import DealDetail from "./pages/deals/deal-detail";
import WebToLead from "./pages/web-to-lead";
import Signup from "./pages/signup";
import Approvals from "./pages/approvals";
import WorkspaceNew from "./pages/workspace-new";
import ForgotPassword from "./pages/forgot-password";
import ResetPassword from "./pages/reset-password";
import ForceChangePassword from "./pages/force-change-password";
import ImportPage from "./pages/import";
import { usePermissions } from "@/hooks/use-permission";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,           // consider data fresh for 30 s — stops redundant refetches
      refetchOnWindowFocus: true,  // refresh when user returns to the tab
    },
  },
});

function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="h-screen w-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  // Let the unguarded dashboard choose a role-appropriate destination. Sending
  // users without dashboard.view directly to /deals can bounce back here when
  // they also lack deals.view, creating an infinite redirect loop.
  return <Redirect to="/dashboard" />;
}

function ProtectedRoute({ component: Component, permission }: { component: any; permission?: string }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { has, isSuperAdmin } = usePermissions();

  // Always wait for the live auth check before evaluating permissions.
  // isLoading is always true until /api/auth/user responds (see AuthProvider).
  if (isLoading) return <div className="h-screen w-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  // Redirect to "/" (not "/dashboard") to avoid a self-referential loop if the
  // user happens to lack permission for the dashboard route itself.
  if (permission && !isSuperAdmin && !has(permission)) return <Redirect to="/" />;

  return (
    <Layout>
      <ErrorBoundary>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/workspace/new" component={WorkspaceNew} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/force-change-password" component={ForceChangePassword} />
      <Route path="/" component={RootRedirect} />
      {/* Dashboard is accessible to all authenticated users — content is role-switched
          internally. Finance is redirected to /deals inside Dashboard itself.
          A permission guard here would redirect Finance to / → /dashboard → infinite loop. */}
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/leads"><ProtectedRoute component={Leads} permission="leads.view" /></Route>
      <Route path="/leads/:id"><ProtectedRoute component={LeadDetail} permission="leads.view" /></Route>
      <Route path="/contacts"><ProtectedRoute component={Contacts} permission="contacts.view" /></Route>
      <Route path="/contacts/:id"><ProtectedRoute component={ContactDetail} permission="contacts.view" /></Route>
      <Route path="/accounts"><ProtectedRoute component={Accounts} permission="contacts.view" /></Route>
      <Route path="/deals"><ProtectedRoute component={Deals} permission="deals.view" /></Route>
      <Route path="/deals/:id"><ProtectedRoute component={DealDetail} permission="deals.view" /></Route>
      <Route path="/activities"><ProtectedRoute component={Activities} permission="activities.view" /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} permission="reports.view" /></Route>
      <Route path="/users"><ProtectedRoute component={Users} permission="users.view" /></Route>
      <Route path="/roles"><ProtectedRoute component={RolesPage} permission="roles.view" /></Route>
      <Route path="/approvals"><ProtectedRoute component={Approvals} permission="approvals.view" /></Route>
      <Route path="/import"><ProtectedRoute component={ImportPage} permission="leads.import" /></Route>
      <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
      <Route path="/audit"><ProtectedRoute component={Audit} permission="audit.view" /></Route>
      <Route path="/web-to-lead" component={WebToLead} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          {/* Top-level boundary: catches any render error in routing/guards
              so the app always shows an error message, never a blank screen. */}
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
