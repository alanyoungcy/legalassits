"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "My Work" },
  { href: "/inbox", label: "Inbox" },
  { href: "/create", label: "Create" },
  { href: "/contracts", label: "Requests" },
  { href: "/templates", label: "Templates" },
  { href: "/skills", label: "Skills" },
  { href: "/contracts", label: "Reports" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith("/workspace");

  if (isWorkspace) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="app-nav">
        <div className="app-nav__brand">
          <strong>capco.</strong>
          <span>Contract Assists</span>
        </div>
        <ul className="app-nav__list">
          {NAV.map((item) => {
            const pathOnly = item.href.split("?")[0];
            const active =
              pathOnly === "/"
                ? pathname === "/"
                : pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
            return (
              <li key={`${item.href}-${item.label}`}>
                <Link href={item.href} data-active={active ? "true" : "false"}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="muted" style={{ marginTop: "auto", fontSize: "0.78rem", padding: "0 0.55rem" }}>
          Capco Wayne helps draft and review. Upload docs for review-first analysis.
        </p>
      </aside>
      <div className="app-main">
        <div className="topbar">
          <input className="topbar__search" placeholder="Search Contracts" />
          <div className="user-chip">
            <span className="user-chip__avatar">AY</span>
            <span>Alan Young</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
