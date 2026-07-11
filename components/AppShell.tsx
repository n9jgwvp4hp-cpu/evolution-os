"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import BrandSwitcher from "@/components/BrandSwitcher";

/**
 * The Evolution OS frame.
 *
 * One conversation is the experience. Everything else — the modules — lives
 * behind a single menu tap. The header stays out of the way; the drawer is
 * the only place the "software" is exposed.
 */
type Item = { href: string; label: string; hint: string; icon: JSX.Element };

const MODULES: Item[] = [
  { href: "/", label: "Assistant", hint: "Talk to Evolution OS", icon: <IconSpark /> },
  { href: "/objectives", label: "Objectives", hint: "Outcomes the OS works", icon: <IconTarget /> },
  { href: "/uw-equity", label: "UW Equity", hint: "Portfolio dashboard", icon: <IconBuilding /> },
  { href: "/activity", label: "Activity", hint: "What ran while away", icon: <IconPulse /> },
  { href: "/approvals", label: "Approvals", hint: "Decisions for you", icon: <IconCheck /> },
  { href: "/leads", label: "Lead Pipeline", hint: "Brand CRM stages", icon: <IconLayers /> },
  { href: "/brands", label: "Brand Settings", hint: "Accounts + connections", icon: <IconTag /> },
  { href: "/onboarding", label: "Onboarding", hint: "Form builder", icon: <IconNote /> },
  { href: "/templates", label: "Templates", hint: "Mission playbooks", icon: <IconBolt /> },
  { href: "/dashboard", label: "Overview", hint: "Everything at a glance", icon: <IconGrid /> },
  { href: "/ops", label: "Command Center", hint: "Live operations", icon: <IconPulse /> },
  { href: "/automations", label: "Automations", hint: "Event-driven rules", icon: <IconBolt /> },
  { href: "/crm", label: "Contacts", hint: "People & leads", icon: <IconUsers /> },
  { href: "/pipeline", label: "Deals", hint: "Property pipeline", icon: <IconLayers /> },
  { href: "/tasks", label: "Tasks", hint: "To-dos", icon: <IconCheck /> },
  { href: "/memory", label: "Memory", hint: "What I remember", icon: <IconBrain /> },
  { href: "/mail", label: "Email", hint: "Gmail", icon: <IconMail /> },
  { href: "/calendar", label: "Calendar", hint: "Schedule", icon: <IconCal /> },
  { href: "/notes", label: "Notes", hint: "Saved writing", icon: <IconNote /> },
  { href: "/files", label: "Files", hint: "Documents", icon: <IconFile /> },
  { href: "/connections", label: "Connections", hint: "Gmail & Calendar", icon: <IconLink /> },
  { href: "/settings", label: "Settings", hint: "Keys & model", icon: <IconGear /> },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation.
  useEffect(() => setOpen(false), [pathname]);

  const title = MODULES.find((m) =>
    m.href === "/" ? pathname === "/" : pathname.startsWith(m.href)
  )?.label;

  return (
    <>
      {/* Minimal top bar */}
      <header className="fixed top-0 inset-x-0 z-40 h-14 safe-top flex items-center gap-3 px-3 bg-void/80 backdrop-blur-xl border-b border-white/10">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/10 transition"
        >
          <IconMenu />
        </button>
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent2 shadow-glow flex items-center justify-center shrink-0">
            <span className="text-void font-black text-sm">E</span>
          </span>
          <span className="font-semibold gradient-text truncate hidden sm:inline">Evolution OS</span>
        </Link>
        {/* Portfolio-wide brand switcher — sets the active brand for scoped views. */}
        <div className="ml-auto flex items-center gap-2">
          <BrandSwitcher />
        </div>
      </header>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`fixed z-50 top-0 left-0 h-full w-72 safe-top p-3 flex flex-col
          bg-surface/95 backdrop-blur-2xl border-r border-white/10
          transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-2 py-3">
          <span className="font-bold gradient-text text-lg">Evolution OS</span>
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/10"
          >
            <IconClose />
          </button>
        </div>
        <p className="px-2 pb-2 text-[11px] uppercase tracking-widest text-slate-600">Capabilities</p>
        <nav className="flex-1 overflow-y-auto flex flex-col gap-1">
          {MODULES.map((m) => {
            const active = m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                  active
                    ? "bg-gradient-to-r from-accent/20 to-accent2/20 border border-accent/30 text-white"
                    : "text-slate-300 hover:bg-white/5 border border-transparent"
                }`}
              >
                <span className={active ? "text-accent" : "text-slate-500"}>{m.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm leading-tight">{m.label}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{m.hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-2 glass p-3 text-[11px] text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulseGlow" />
          One brain, many capabilities.
        </div>
      </aside>

      {/* Content (chat fills the screen; modules add their own padding) */}
      <main className="pt-14">{children}</main>
    </>
  );
}

/* ---- inline icons ---- */
function svg(children: React.ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconLink() { return svg(<><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></>); }
function IconMenu() { return svg(<path d="M4 6h16M4 12h16M4 18h16" />); }
function IconClose() { return svg(<path d="M18 6 6 18M6 6l12 12" />); }
function IconSpark() { return svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4z" /></>); }
function IconGrid() { return svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>); }
function IconPulse() { return svg(<path d="M3 12h4l3 8 4-16 3 8h4" />); }
function IconBolt() { return svg(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />); }
function IconUsers() { return svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>); }
function IconLayers() { return svg(<><path d="M12 2 2 7l10 5 10-5z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>); }
function IconCheck() { return svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>); }
function IconBrain() { return svg(<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />); }
function IconMail() { return svg(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>); }
function IconCal() { return svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>); }
function IconNote() { return svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>); }
function IconFile() { return svg(<><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M13 2v7h7" /></>); }
function IconGear() { return svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>); }
function IconBuilding() { return svg(<><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></>); }
function IconTarget() { return svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>); }
function IconTag() { return svg(<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></>); }
