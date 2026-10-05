import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Cpu,
  FolderKanban,
  KeyRound,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, setToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AppShell({ user }: { user: User }) {
  const navigate = useNavigate();
  const [licensed, setLicensed] = useState(true);
  const [pendingCheckout, setPendingCheckout] = useState(false);
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

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel/70 p-4 md:flex md:flex-col">
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
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
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
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-ink"
            onClick={() => {
              setToken(null);
              navigate("/login");
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <div className="font-semibold">BOX IO</div>
          <div className="flex gap-2 text-xs">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className="text-muted">
                {l.label}
              </NavLink>
            ))}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">
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
