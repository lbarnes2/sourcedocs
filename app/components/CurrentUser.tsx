"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "@/types/auth";

const CurrentUserContext = createContext<CurrentUser | null>(null);

/** The signed-in user, or null while loading. */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
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
