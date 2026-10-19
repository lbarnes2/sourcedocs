"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { Callout, Field, Modal, Section } from "@/app/components/ui";
import { ROLES, type Role } from "@/lib/auth/roles";
import { readResponseError } from "@/lib/http/readError";
import type { ManagedUser } from "@/types/auth";

const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };

/** A temporary password to hand over; shown once, then gone. */
type Handover = { name: string; email: string; password: string; isNew: boolean };

function statusBadge(user: ManagedUser) {
  if (!user.active) return <span className="badge">Deactivated</span>;
  if (user.locked) return <span className="badge badge--danger">Locked</span>;
  if (user.mustChangePassword) return <span className="badge badge--warning">Temporary password</span>;
  return <span className="badge badge--success">Active</span>;
}

export function UsersSection({ currentUserId, onError }: { currentUserId: string; onError: (message: string) => void }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ email: string; name: string; role: Role }>({ email: "", name: "", role: "editor" });
  const [handover, setHandover] = useState<Handover | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (!res.ok) throw new Error(await readResponseError(res, "Could not load users."));
    setUsers(((await res.json()) as { users: ManagedUser[] }).users);
  }, []);

  useEffect(() => {
    load().catch((e: unknown) => onError(e instanceof Error ? e.message : "Could not load users."));
  }, [load, onError]);

  function showHandover(user: ManagedUser, password: string, isNew: boolean) {
    setCopied(false);
    setHandover({ name: user.name, email: user.email, password, isNew });
  }

  async function addUser(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not add user."));
      const { user, temporaryPassword } = (await res.json()) as { user: ManagedUser; temporaryPassword: string };
      setDraft({ email: "", name: "", role: draft.role });
      showHandover(user, temporaryPassword, true);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add user.");
    } finally {
      setAdding(false);
    }
  }

  async function patch(user: ManagedUser, change: Partial<Pick<ManagedUser, "role" | "active">> | { resetPassword: true }) {
    setWorkingId(user.id);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change)
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not update user."));
      const data = (await res.json()) as { user: ManagedUser; temporaryPassword: string | null };
      if (data.temporaryPassword) showHandover(data.user, data.temporaryPassword, false);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update user.");
      await load().catch(() => undefined);
    } finally {
      setWorkingId(null);
    }
  }

  async function resetPassword(user: ManagedUser) {
    const message = `Give ${user.name} a new temporary password? Their current password stops working straight away${
      user.locked ? ", and their lockout is cleared" : ""
    }.`;
    if (window.confirm(message)) await patch(user, { resetPassword: true });
  }

  async function setActive(user: ManagedUser, active: boolean) {
    if (!active && !window.confirm(`Deactivate ${user.name}? They won't be able to sign in or save anything.`)) return;
    await patch(user, { active });
  }

  async function remove(user: ManagedUser) {
    if (!window.confirm(`Delete ${user.name}'s account permanently? Deactivating keeps it in case they come back.`)) return;
    setWorkingId(user.id);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not delete user."));
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not delete user.");
    } finally {
      setWorkingId(null);
    }
  }

  async function copyPassword() {
    if (!handover) return;
    try {
      await navigator.clipboard.writeText(handover.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section
      title="Users"
      description="Viewers can look and print. Editors can also save and delete. Admins can also change Settings and manage users."
    >
      <div className="stack">
        {users === null ? (
          <p className="text-muted">Loading users…</p>
        ) : (
          <div className="users-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const self = user.id === currentUserId;
                  const busy = workingId === user.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="users-name">
                          {user.name}
                          {self ? <span className="text-muted"> (you)</span> : null}
                        </div>
                        <div className="text-muted text-sm">{user.email}</div>
                      </td>
                      <td>
                        <select
                          value={user.role}
                          disabled={self || busy}
                          title={self ? "Another admin has to change your role." : undefined}
                          aria-label={`Role for ${user.name}`}
                          onChange={(e) => void patch(user, { role: e.target.value as Role })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{statusBadge(user)}</td>
                      <td>
                        {self ? null : (
                          <div className="row row--end users-actions">
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={busy}
                              onClick={() => void resetPassword(user)}
                            >
                              <KeyRound size={14} aria-hidden />
                              Reset password
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={busy}
                              onClick={() => void setActive(user, !user.active)}
                            >
                              {user.active ? "Deactivate" : "Reactivate"}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              disabled={busy}
                              aria-label={`Delete ${user.name}`}
                              title="Delete account"
                              onClick={() => void remove(user)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form className="users-add" onSubmit={addUser}>
          <Field label="Name">
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              required
            />
          </Field>
          <Field label="Role">
            <select value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as Role }))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn-primary" disabled={adding}>
            <UserPlus size={16} aria-hidden />
            {adding ? "Adding…" : "Add user"}
          </button>
        </form>
      </div>

      {handover ? (
        <Modal
          title={handover.isNew ? "Account created" : "Password reset"}
          onClose={() => setHandover(null)}
          size="sm"
          footer={
            <button type="button" className="btn-primary" onClick={() => setHandover(null)}>
              Done
            </button>
          }
        >
          <div className="stack">
            <p>
              Give this temporary password to <strong>{handover.name}</strong> ({handover.email}). They&apos;ll choose
              their own when they first sign in.
            </p>
            <div className="row users-temp">
              <code className="users-temp-password">{handover.password}</code>
              <button type="button" className="btn-sm" onClick={() => void copyPassword()}>
                <Copy size={14} aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <Callout tone="warning">This is the only time it&apos;s shown. Reset it again if it gets lost.</Callout>
          </div>
        </Modal>
      ) : null}
    </Section>
  );
}
