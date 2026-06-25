"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * iPhone-style bottom tab bar. Shown only on small screens; the full
 * navigation lives in the slide-out sidebar (hamburger, top-right).
 */
const tabs = [
  { href: "/", label: "Home", icon: home },
  { href: "/crm", label: "Leads", icon: users },
  { href: "/chat", label: "Ask", icon: mic, primary: true },
  { href: "/pipeline", label: "Deals", icon: layers },
  { href: "/tasks", label: "Tasks", icon: check },
];

export default function MobileNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe bg-void/85 backdrop-blur-xl border-t border-white/10">
      <div className="flex items-stretch justify-around px-2 pt-1.5">
        {tabs.map((t) => {
          const active = isActive(t.href);
          if (t.primary) {
            return (
              <Link key={t.href} href={t.href} className="flex flex-col items-center -mt-5">
                <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-accent2 text-void flex items-center justify-center shadow-glow">
                  {t.icon()}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">{t.label}</span>
              </Link>
            );
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 ${
                active ? "text-accent" : "text-slate-500"
              }`}
            >
              {t.icon()}
              <span className="text-[10px]">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function svg(children: React.ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function home() {
  return svg(<><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>);
}
function users() {
  return svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>);
}
function layers() {
  return svg(<><path d="M12 2 2 7l10 5 10-5z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>);
}
function check() {
  return svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>);
}
function mic() {
  return svg(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></>);
}
