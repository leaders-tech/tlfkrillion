/*
This file shows the login and registration forms.
Edit this file when account form behavior changes.
Copy this file as a starting point when you add another simple form page.
*/

import { useActionState, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../app/auth";

export function LoginPage({ signup = false }: { signup?: boolean }) {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // React 19 form action: `error` is what the action returned last time, `busy` is true while it runs.
  const [error, submit, busy] = useActionState(async () => {
    try {
      await (signup ? register : login)(username, password);
      navigate("/", { replace: true });
      return "";
    } catch (submitError) {
      return submitError instanceof Error ? submitError.message : "Could not sign in. Please try again.";
    }
  }, "");

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="login-panel mx-auto max-w-md rounded-3xl border border-slate-200/80 bg-white/85 p-8 shadow-lg shadow-slate-200/70">
      <h2 className="text-2xl font-semibold text-slate-900">{signup ? "Create an account" : "Login"}</h2>
      <p className="mt-2 text-sm text-slate-600">
        {signup ? "Choose a username and a password to start diving." : "Sign in with your account to create a room or join your friends."}
      </p>
      <form className="mt-6 space-y-4" action={submit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
          <input
            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3"
            autoComplete="username"
            required
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </label>
        {signup && <p className="text-sm text-slate-600">Use 3–24 letters, numbers, dashes, or underscores in your username.</p>}
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
          <input
            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3"
            autoComplete={signup ? "new-password" : "current-password"}
            maxLength={signup ? 128 : undefined}
            minLength={signup ? 8 : undefined}
            required
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        {signup && <p className="text-sm text-slate-600">Use at least 8 characters in your password.</p>}
        {error ? (
          <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <button className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white" disabled={busy || loading} type="submit">
          {signup ? (busy ? "Creating account…" : "Create account") : (busy ? "Logging in..." : "Login")}
        </button>
      </form>
      <Link className="mt-4 inline-block text-sm underline" to={signup ? "/login" : "/register"}>
        {signup ? "Already have an account? Sign in" : "Create account"}
      </Link>
    </section>
  );
}
