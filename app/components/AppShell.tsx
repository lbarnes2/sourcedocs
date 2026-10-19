"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CurrentUserProvider, useCurrentUser } from "./CurrentUser";
import { NAV_TOOLS } from "./navTools";

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.assign("/login");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <CurrentUserProvider>
      <ShellFrame>{children}</ShellFrame>
    </CurrentUserProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
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
            <Link
              href="/account"
              className={pathname === "/account" ? "sidebar-user sidebar-user--active" : "sidebar-user"}
              aria-current={pathname === "/account" ? "page" : undefined}
              title={`${user.email}: account and password`}
            >
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-role">{user.role}</span>
            </Link>
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
