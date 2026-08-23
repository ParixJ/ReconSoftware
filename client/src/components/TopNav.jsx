import { CircleUserRound, FileCheck2, LogOut, Scale } from "lucide-react";
import { useAuthStore } from "../store/authStore.js";

export default function TopNav() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <a className="brand brand-small" href="#workspace"><span className="brand-mark"><Scale size={18} /></span><span>Reconcile GST</span></a>
        <nav aria-label="Workspace navigation">
          <a href="#workspace" className="nav-active">Workspace</a>
          <a href="#documents">Documents</a>
          <a href="#results">Results</a>
        </nav>
        <div className="topnav-actions">
          <span className="storage-label"><FileCheck2 size={16} />Local secure storage</span>
          <div className="user-menu"><CircleUserRound size={19} /><span><strong>{user?.name}</strong><small>{user?.email}</small></span></div>
          <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </div>
    </header>
  );
}

