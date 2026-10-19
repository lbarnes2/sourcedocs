"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hasRole } from "@/lib/auth/roles";
import type { CurrentUser } from "@/types/auth";

const CurrentUserContext = createContext<CurrentUser | null>(null);

/** The signed-in user, or null while loading. */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}

/**
 * What the signed-in user may change. Both are false until the user has loaded, so editing controls
 * never flash up for viewers. The server enforces the same rules; this only keeps the screens honest.
 */
export function useAccess(): { user: CurrentUser | null; canEdit: boolean; isAdmin: boolean } {
  const user = useCurrentUser();
  return {
    user,
    canEdit: user !== null && hasRole(user.role, "editor"),
    isAdmin: user?.role === "admin"
  };
}

/**
 * Loads the signed-in user once per page load. A 401 (deactivated, deleted or expired) sends the
 * browser to the sign-in page.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) {
          /* Clear the cookie first: a signed cookie for a deactivated account would otherwise
             bounce straight back from /login. */
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          window.location.assign("/login");
          return;
        }
        if (r.ok && !cancelled) setUser(((await r.json()) as { user: CurrentUser }).user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}
