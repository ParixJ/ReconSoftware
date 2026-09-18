import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import ReconciliationsPage from "./pages/ReconciliationsPage.jsx";
import WorkspacePage from "./pages/WorkspacePage.jsx";
import { Spinner } from "@/components/ui/spinner";
import { useAuthStore } from "./store/authStore.js";

function Protected({ children }) {
  const { status } = useAuthStore();
  if (status === "checking") return <div className="grid min-h-screen place-content-center gap-3 bg-background text-center text-sm text-muted-foreground"><Spinner className="mx-auto size-5 text-primary" label="Loading secure workspace" />Loading secure workspace…</div>;
  return status === "authenticated" ? children : <Navigate to="/auth" replace />;
}

function LegacyWorkspaceRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: location.pathname.replace(/^\/workspace/, "/home"), search: location.search, hash: location.hash }} replace />;
}

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const status = useAuthStore((state) => state.status);
  useEffect(() => { initialize(); }, [initialize]);
  
  return (
    <Routes>
      <Route path="/auth" element={status === "authenticated" ? <Navigate to="/home" replace /> : <AuthPage />} />
      <Route path="/home/*" element={<Protected><WorkspacePage /></Protected>} />
      <Route path="/reconciliations" element={<Protected><ReconciliationsPage /></Protected>} />
      <Route path="/workspace/*" element={<LegacyWorkspaceRedirect />} />
      <Route path="*" element={<Navigate to={status === "authenticated" ? "/home" : "/auth"} replace />} />
    </Routes>
  );
}

