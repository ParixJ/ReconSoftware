import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AuthPage from "./pages/AuthPage.jsx";
import WorkspacePage from "./pages/WorkspacePage.jsx";
import { useAuthStore } from "./store/authStore.js";

function Protected({ children }) {
  const { status } = useAuthStore();
  if (status === "checking") return <div className="app-loading"><span className="spinner" />Loading secure workspace…</div>;
  return status === "authenticated" ? children : <Navigate to="/auth" replace />;
}

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const status = useAuthStore((state) => state.status);
  useEffect(() => { initialize(); }, [initialize]);
  
  return (
    <Routes>
      <Route path="/auth" element={status === "authenticated" ? <Navigate to="/workspace" replace /> : <AuthPage />} />
      <Route path="/workspace/*" element={<Protected><WorkspacePage /></Protected>} />
      <Route path="*" element={<Navigate to={status === "authenticated" ? "/workspace" : "/auth"} replace />} />
    </Routes>
  );
}

