import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, getToken, setToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { LoginPage, SetupPage } from "@/pages/Login";
import { InvitePage } from "@/pages/Invite";
import { ProjectsPage } from "@/pages/Projects";
import { KeysPage } from "@/pages/Keys";
import { AdminPage } from "@/pages/Admin";
import { SettingsPage } from "@/pages/Settings";
import { LicensePage } from "@/pages/License";
import { ProjectBoardPage } from "@/pages/ProjectBoard";

export default function App() {
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.get<{ setupRequired: boolean }>("/api/setup-status");
        if (cancelled) return;
        setSetupRequired(status.setupRequired);
        if (!status.setupRequired && getToken()) {
          try {
            const me = await api.get<{ user: User }>("/api/auth/me");
            if (!cancelled) setUser(me.user);
          } catch {
            setToken(null);
          }
        }
      } catch {
        /* server still starting */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted">Starting Box IO…</div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={setupRequired ? <SetupPage /> : <Navigate to="/login" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route
        element={
          user ? (
            <AppShell user={user} />
          ) : setupRequired ? (
            <Navigate to="/setup" />
          ) : (
            <Navigate to="/login" />
          )
        }
      >
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectBoardPage />} />
        <Route path="/keys" element={user?.role === "viewer" ? <Navigate to="/" /> : <KeysPage />} />
        <Route path="/admin" element={user?.role === "viewer" ? <Navigate to="/" /> : <AdminPage />} />
        <Route path="/settings" element={user?.role === "admin" ? <SettingsPage /> : <Navigate to="/" />} />
        <Route path="/license" element={user?.role === "viewer" ? <Navigate to="/" /> : <LicensePage />} />
      </Route>
    </Routes>
  );
}
