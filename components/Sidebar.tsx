"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; icon: JSX.Element };

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <IconGrid /> },
  { href: "/chat", label: "AI Assistant", icon: <IconChat /> },
  { href: "/crm", label: "CRM · Leads", icon: <IconUsers /> },
  { href: "/pipeline", label: "Pipeline", icon: <IconLayers /> },
  { href: "/tasks", label: "Tasks", icon: <IconCheck /> },
  { href: "/memory", label: "Memory", icon: <IconBrain /> },
  { href: "/mail", label: "Gmail", icon: <IconMail /> },
  { href: "/calendar", label: "Calendar", icon: <IconCalendar /> },
  { href: "/notes", label: "Notes", icon: <IconNote /> },
  { href: "/files", label: "Files", icon: <IconFile /> },
  { href: "/settings", label: "Settings", icon: <IconGear /> },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 h-14 bg-void/80 backdrop-blur-xl border-b border-white/10">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold gradient-text">Evolution OS</span>
        </Link>
        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost !px-2 !py-2"
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed z-50 top-0 left-0 h-full w-64 p-4 flex flex-col gap-2
          bg-surface/80 backdrop-blur-2xl border-r border-white/10
          transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 px-2 py-4"
        >
          <Logo />
          <div>
            <div className="font-bold text-lg gradient-text leading-none">
              Evolution OS
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              personal AI assistant
            </div>
          </div>
        </Link>

        <nav className="flex flex-col gap-1 mt-2">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition
                  ${
                    active
                      ? "bg-gradient-to-r from-accent/20 to-accent2/20 text-white border border-accent/30 shadow-glow"
                      : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                  }`}
              >
                <span
                  className={
                    active ? "text-accent" : "text-slate-500 group-hover:text-accent"
                  }
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto glass p-3 text-xs text-slate-400">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulseGlow" />
            <span className="text-slate-300 font-medium">System online</span>
          </div>
          Connect your OpenAI key in{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Settings
          </Link>
          .
        </div>
      </aside>
    </>
  );
}

function Logo() {
  return (
    <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent2 shadow-glow flex items-center justify-center">
      <span className="text-void font-black text-lg">E</span>
    </div>
  );
}

/* ---- Inline icons (no external icon library needed) ---- */
function base(props: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </svg>
  );
}
function IconGrid() {
  return base({
    children: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
  });
}
function IconChat() {
  return base({
    children: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  });
}
function IconLayers() {
  return base({
    children: (
      <>
        <path d="M12 2 2 7l10 5 10-5z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </>
    ),
  });
}
function IconNote() {
  return base({
    children: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h6" />
      </>
    ),
  });
}
function IconCheck() {
  return base({
    children: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
  });
}
function IconFile() {
  return base({
    children: (
      <>
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M13 2v7h7" />
      </>
    ),
  });
}
function IconGear() {
  return base({
    children: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  });
}
function IconUsers() {
  return base({
    children: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  });
}
function IconBrain() {
  return base({
    children: (
      <>
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
      </>
    ),
  });
}
function IconMail() {
  return base({
    children: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 5L2 7" />
      </>
    ),
  });
}
function IconCalendar() {
  return base({
    children: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  });
}
function IconMenu() {
  return base({ children: <path d="M4 6h16M4 12h16M4 18h16" /> });
}
function IconClose() {
  return base({ children: <path d="M18 6 6 18M6 6l12 12" /> });
}
