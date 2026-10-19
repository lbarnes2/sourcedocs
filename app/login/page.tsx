"use client";

import { useState, type FormEvent } from "react";
import { Callout, Field } from "@/app/components/ui";
import { readResponseError } from "@/lib/http/readError";

/** Only same-site paths, so a crafted link can't bounce users to another site after sign-in. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        setError(await readResponseError(response, "Sign-in failed."));
        setBusy(false);
        return;
      }
      /* Full navigation so the app shell reloads with the new session. */
      window.location.assign(safeNext());
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="sidebar-brand-mark" aria-hidden>
            EC
          </span>
          <span>Event Collateral</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        {error ? <Callout tone="error">{error}</Callout> : null}
        <Field label="Email">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button type="submit" className="btn-primary login-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-help">Forgotten your password? Ask an admin to reset it.</p>
      </form>
    </main>
  );
}
