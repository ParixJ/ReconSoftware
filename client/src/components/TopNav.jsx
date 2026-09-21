import { CircleUserRound, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthStore } from "../store/authStore.js";
import ThemeToggle from "./ThemeToggle.jsx";

export default function TopNav() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const location = useLocation();
  const onHome = location.pathname.startsWith("/home");
  const navClass = (active) => cn(
    "flex h-10 items-center border-b-2 border-transparent px-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3",
    active && "border-primary text-foreground",
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 w-full max-w-[1600px] items-center gap-3 px-3 sm:px-5 lg:px-8">
        <Link className="flex shrink-0 items-center gap-2 text-base text-foreground" to="/home">
          <span className="hidden sm:inline">ReconSoft</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap" aria-label="Primary navigation">
          <Link to="/home" className={navClass(onHome && location.hash !== "#documents")} aria-current={onHome && location.hash !== "#documents" ? "page" : undefined}>Home</Link>
          <Link to="/home#documents" className={navClass(onHome && location.hash === "#documents")} aria-current={onHome && location.hash === "#documents" ? "page" : undefined}>Documents</Link>
          <Link to="/reconciliations" className={navClass(location.pathname === "/reconciliations")} aria-current={location.pathname === "/reconciliations" ? "page" : undefined}>Reconciliations</Link>
          <Link to="/scrutiny/audit-reports" className={navClass(location.pathname.startsWith("/scrutiny/audit-reports"))} aria-current={location.pathname.startsWith("/scrutiny/audit-reports") ? "page" : undefined}>Audit reports</Link>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <div className="hidden items-center gap-2 px-2 text-sm text-muted-foreground lg:flex">
            <CircleUserRound className="size-[18px]" aria-hidden="true" />
            <span className="flex max-w-48 flex-col leading-tight"><span className="truncate text-foreground">{user?.name}</span><small className="truncate text-xs">{user?.email}</small></span>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut aria-hidden="true" /></Button>
        </div>
      </div>
    </header>
  );
}
