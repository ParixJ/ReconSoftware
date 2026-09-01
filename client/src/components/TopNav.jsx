import { CircleUserRound, FileCheck2, LogOut, Scale } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";
import ThemeToggle from "./ThemeToggle.jsx";

export default function TopNav() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const location = useLocation();
  const onHome = location.pathname.startsWith("/home");
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link className="brand brand-small" to="/home"><span className="brand-mark"><Scale size={18} /></span><span>ReconSoft</span></Link>
        <nav aria-label="Primary navigation">
          <Link to="/home" className={onHome && location.hash !== "#documents" ? "nav-active" : ""} aria-current={onHome && location.hash !== "#documents" ? "page" : undefined}>Home</Link>
          <Link to="/home#documents" className={onHome && location.hash === "#documents" ? "nav-active" : ""} aria-current={onHome && location.hash === "#documents" ? "page" : undefined}>Documents</Link>
          <Link to="/reconciliations" className={location.pathname === "/reconciliations" ? "nav-active" : ""} aria-current={location.pathname === "/reconciliations" ? "page" : undefined}>Reconciliations</Link>
        </nav>
        <div className="topnav-actions">
          <span className="storage-label"><FileCheck2 size={16} />Local secure storage</span>
          <ThemeToggle />
          <div className="user-menu"><CircleUserRound size={19} /><span><strong>{user?.name}</strong><small>{user?.email}</small></span></div>
          <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </div>
    </header>
  );
}

