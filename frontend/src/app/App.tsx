/*
This file builds the main frontend layout, routes, and route guards.
Edit this file when top-level pages, navigation, or auth guard behavior changes.
Copy the route pattern here when you add another top-level page.
*/

import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "./auth";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { AdminPage } from "../pages/AdminPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { clearSavedRoomCode } from "../shared/gameSession";
import type { SocketStatus } from "../shared/socket";
import { ProfilePage } from "../pages/ProfilePage";
import "./navigation.css";

function Layout({ children, status }: { children: React.ReactNode; status: SocketStatus }) {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const onLogout = async () => {
    setError("");
    try {
      await logout();
      clearSavedRoomCode();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Could not log out. Please try again.");
    }
  };

  return (
    <div className="min-h-screen">
      <div className="navigation-rail">
        <button className="navigation-trigger" type="button" aria-label="Menu" aria-expanded={menuOpen} aria-controls="main-menu" onClick={() => setMenuOpen(!menuOpen)}>
          <span aria-hidden="true">☰</span>
        </button>
        {user && <NavLink className="navigation-trigger profile-trigger" aria-label="Profile" to="/profile" onClick={() => setMenuOpen(false)}><span aria-hidden="true">◉</span></NavLink>}
        {menuOpen && (
          <nav id="main-menu" className="navigation-menu" aria-label="Main menu">
            <p className="navigation-title">Krillion</p>
            {user && <p className={`menu-status ${status}`}><i />{status === "connected" ? "Connected" : status === "idle" ? "Not connected" : status}</p>}
            <NavLink to="/" onClick={() => setMenuOpen(false)}>{user ? "Dive" : "Home"}</NavLink>
            {user ? (
              <>
                {user.is_admin && (
                  <NavLink to="/admin" onClick={() => setMenuOpen(false)}>
                    Questions
                  </NavLink>
                )}
                <button onClick={() => void onLogout()}>
                  Logout
                </button>
              </>
            ) : (
              <NavLink to="/login" onClick={() => setMenuOpen(false)}>
                Login
              </NavLink>
            )}
          </nav>
        )}
      </div>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {error ? (
          <p role="alert" className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-rose-700">
            {error}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <p className="text-slate-600">Loading session...</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const [status, setStatus] = useState<SocketStatus>("idle");
  return (
    <Layout status={status}>
      <Routes>
        <Route path="/" element={<HomePage onConnectionStatus={setStatus} />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
