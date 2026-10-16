"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_TOOLS } from "./navTools";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
        </nav>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  );
}
