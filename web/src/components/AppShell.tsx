import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Cpu,
  FolderKanban,
  KeyRound,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, setToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AppShell({ user }: { user: User }) {
  const navigate = useNavigate();
  const [licensed, setLicensed] = useState(true);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let stop = false;
    function apply(data: { licensed: boolean; pendingCheckout?: string }) {
      if (stop) return;
      setLicensed(data.licensed);
      setPendingCheckout(Boolean(data.pendingCheckout));
    }
    function load() {
      api
        .get<{ licensed: boolean; pendingCheckout?: string }>("/api/license/status")
        .then(apply)
        .catch(() => {
          if (!stop) setLicensed(true);
        });
    }
    function onLicense(event: Event) {
      const detail = (event as CustomEvent<{ licensed?: boolean; pendingCheckout?: string }>).detail;
      if (detail && typeof detail.licensed === "boolean") apply({ licensed: detail.licensed, pendingCheckout: detail.pendingCheckout });
    }
    load();
    window.addEventListener("boxio-license", onLicense);
    return () => {
      stop = true;
      window.removeEventListener("boxio-license", onLicense);
    };
  }, []);
  const viewer = user.role === "viewer";
  const links = [
    { to: "/", label: "Projects", icon: FolderKanban },
    ...(!viewer
      ? [
          { to: "/keys", label: "Device keys", icon: KeyRound },
          { to: "/license", label: "License", icon: ShieldCheck },
          { to: "/admin", label: "Users", icon: Users },
        ]
      : []),
    ...(user.role === "admin" ? [{ to: "/settings", label: "Settings", icon: Settings }] : []),
  ];

  function signOut() {
    setToken(null);
    navigate("/login");
  }

  const menu = (
    <>
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Cpu size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">BOX IO</div>
          <div className="text-[11px] text-muted">Self-hosted IoT</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg px-3 py-3 text-sm md:py-2",
                isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-white/5 hover:text-ink",
              )
            }
          >
            <link.icon size={16} />
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-3">
        <div className="px-2 text-xs text-muted">{user.username}</div>
        <button
          type="button"
          className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-3 text-sm text-muted hover:bg-white/5 hover:text-ink md:py-2"
          onClick={signOut}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel/70 p-4 md:flex md:flex-col">{menu}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel p-4 shadow-xl">
            <button
              type="button"
              className="mb-2 self-end rounded-lg p-2 text-muted"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={18} />
            </button>
            {menu}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/95 px-3 py-2 backdrop-blur md:hidden">
          <button
            type="button"
            className="rounded-lg p-2 text-ink"
            aria-label="Menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="font-semibold">BOX IO</div>
        </header>
        <main className="flex-1 p-4 pb-24 md:p-8">
          {licensed ? null : (
            <p className="mb-4 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              {viewer
                ? "Pin values stay hidden until the server owner installs a license."
                : pendingCheckout
                  ? "A license file is on this server, but it is not finished. Open License, copy the checkout code to your account, then paste the confirmation code."
                  : "Pin values are hidden until this server has a valid license. Open License to install a trial or a paid year."}
            </p>
          )}
          <Outlet context={user} />
        </main>
      </div>
    </div>
  );
}
