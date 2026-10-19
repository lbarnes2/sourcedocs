"use client";

import { useState, type FormEvent } from "react";
import { useCurrentUser } from "@/app/components/CurrentUser";
import { Callout, Field, PageHeader, Section } from "@/app/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordRules";
import { readResponseError } from "@/lib/http/readError";

const ROLE_SUMMARY = {
  viewer: "You can view everything and download PDFs, but not save or delete.",
  editor: "You can view, save and delete across all tools.",
  admin: "You can do everything, including Settings and managing users."
} as const;

export default function AccountPage() {
  const user = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const forced = user?.mustChangePassword ?? false;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone(false);
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== repeat) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not change password."));
      if (forced) {
        window.location.assign("/");
        return;
      }
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <PageHeader title="Your account" description={user ? `${user.name} · ${user.email}` : undefined} />

      {forced ? (
        <Callout tone="warning">
          You signed in with a temporary password. Choose a new one to carry on.
        </Callout>
      ) : null}

      {user ? (
        <Section title="Access" description={ROLE_SUMMARY[user.role]}>
          <span className="badge badge--accent account-role">{user.role}</span>
        </Section>
      ) : null}

      <Section title="Change password" description={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easier to remember than a jumble.`}>
        <form className="stack account-form" onSubmit={onSubmit}>
          <Field label={forced ? "Temporary password" : "Current password"}>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </Field>
          <Field label="Repeat new password">
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </Field>
          {error ? <Callout tone="error">{error}</Callout> : null}
          {done ? <Callout tone="info">Password changed.</Callout> : null}
          <div className="row">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      </Section>
    </main>
  );
}
