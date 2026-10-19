"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "@/types/auth";
import { NAV_TOOLS } from "./navTools";

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.assign("/login");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (isLogin) return;
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ user: CurrentUser }>) : null))
      .then((data) => {
        if (!cancelled && data) setUser(data.user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isLogin]);

  if (isLogin) return <>{children}</>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden>
            EC
          </span>
          <span>Event Collateral</span>
        </Link>
        <nav className="sidebar-nav" aria-label="Tools">
          {NAV_TOOLS.map((tool) => {
            const active = pathname === tool.href || pathname?.startsWith(`${tool.href}/`);
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={active ? "sidebar-link sidebar-link--active" : "sidebar-link"}
                aria-current={active ? "page" : undefined}
                style={{ ["--tool-color" as string]: tool.color }}
              >
                <Icon size={18} className="sidebar-link-icon" aria-hidden />
                <span>{tool.shortName}</span>
              </Link>
            );
          })}
        </nav>
        <nav className="sidebar-nav sidebar-foot" aria-label="Settings">
          <Link
            href="/settings"
            className={pathname?.startsWith("/settings") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
            aria-current={pathname?.startsWith("/settings") ? "page" : undefined}
          >
            <Settings size={18} className="sidebar-link-icon" aria-hidden />
            <span>Settings</span>
          </Link>
          {user ? (
            <div className="sidebar-user" title={user.email}>
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-role">{user.role}</span>
            </div>
          ) : null}
          <button type="button" className="sidebar-link" onClick={() => void signOut()}>
            <LogOut size={18} className="sidebar-link-icon" aria-hidden />
            <span>Sign out</span>
          </button>
        </nav>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  );
}
