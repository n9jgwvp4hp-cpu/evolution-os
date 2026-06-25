"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import {
  useLocalStorage,
  formatMoney,
  timeAgo,
  type Project,
  type Note,
  type Task,
  type Contact,
  type Deal,
} from "@/lib/store";

export default function Dashboard() {
  const [projects] = useLocalStorage<Project[]>("evo.projects", []);
  const [notes] = useLocalStorage<Note[]>("evo.notes", []);
  const [tasks] = useLocalStorage<Task[]>("evo.tasks", []);
  const [contacts] = useLocalStorage<Contact[]>("evo.contacts", []);
  const [deals] = useLocalStorage<Deal[]>("evo.deals", []);

  const openTasks = tasks.filter((t) => !t.done);
  const activeDeals = deals.filter((d) => !["closed", "lost"].includes(d.stage));
  const activeLeads = contacts.filter((c) => !["closed", "lost"].includes(c.status));
  const pipelineValue = activeDeals.reduce((s, d) => s + (d.price || 0), 0);

  const stats = [
    { label: "Active Leads", value: activeLeads.length, sub: `${contacts.length} total`, href: "/crm" },
    { label: "Open Deals", value: activeDeals.length, sub: formatMoney(pipelineValue), href: "/pipeline" },
    { label: "Open Tasks", value: openTasks.length, sub: `${tasks.length} total`, href: "/tasks" },
    { label: "Notes", value: notes.length, sub: "saved", href: "/notes" },
  ];

  const hotDeals = [...activeDeals]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  const recentLeads = [...activeLeads]
    .sort((a, b) => b.lastTouch - a.lastTouch)
    .slice(0, 5);
  const priorityTasks = [...openTasks]
    .sort((a, b) => order(b.priority) - order(a.priority))
    .slice(0, 5);
  const recentNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Command Center"
        subtitle="Everything that matters, in one place."
        action={
          <Link href="/chat" className="btn-primary">
            🎙️ Ask assistant
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card group">
            <div className="text-slate-400 text-sm">{s.label}</div>
            <div className="text-3xl font-bold text-white mt-1 group-hover:text-accent transition">
              {s.value}
            </div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Pipeline */}
        <Panel title="Hot deals" href="/pipeline" cta="Pipeline">
          {hotDeals.length === 0 ? (
            <Empty label="No active deals. Add one in the pipeline." />
          ) : (
            <div className="space-y-2">
              {hotDeals.map((d) => (
                <Link key={d.id} href="/pipeline" className="row">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate">{d.address}</div>
                    <div className="text-[11px] text-slate-500 capitalize">
                      {d.stage.replace("_", " ")} · {d.side === "buy" ? "buyer" : "seller"}
                    </div>
                  </div>
                  <span className="text-xs text-accent shrink-0">{formatMoney(d.price)}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Leads */}
        <Panel title="Recent leads" href="/crm" cta="CRM">
          {recentLeads.length === 0 ? (
            <Empty label="No leads yet. Add contacts in the CRM." />
          ) : (
            <div className="space-y-2">
              {recentLeads.map((c) => (
                <Link key={c.id} href="/crm" className="row">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-500 capitalize">
                      {c.type} · {c.status}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-600 shrink-0">{timeAgo(c.lastTouch)}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Tasks */}
        <Panel title="Priority tasks" href="/tasks" cta="Tasks">
          {priorityTasks.length === 0 ? (
            <Empty label="No open tasks. Nice and clear." />
          ) : (
            <div className="space-y-2">
              {priorityTasks.map((t) => (
                <Link key={t.id} href="/tasks" className="row">
                  <span className="text-sm text-slate-100 truncate">{t.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize shrink-0 ${pStyle(t.priority)}`}>
                    {t.priority}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Notes */}
        <Panel title="Recent notes" href="/notes" cta="Notes">
          {recentNotes.length === 0 ? (
            <Empty label="No notes yet. Capture an idea." />
          ) : (
            <div className="space-y-2">
              {recentNotes.map((n) => (
                <Link key={n.id} href="/notes" className="row">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate">{n.title || "Untitled"}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {n.body ? n.body.slice(0, 50) : "Empty"}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-600 shrink-0">{timeAgo(n.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Quick actions */}
      <div className="glass p-5 mt-4">
        <h3 className="font-semibold text-white mb-3">Quick actions</h3>
        <div className="flex flex-wrap gap-2">
          <QuickLink href="/crm" label="+ Lead" />
          <QuickLink href="/pipeline" label="+ Deal" />
          <QuickLink href="/tasks" label="+ Task" />
          <QuickLink href="/notes" label="+ Note" />
          <QuickLink href="/memory" label="🧠 Teach memory" />
          <QuickLink href="/mail" label="✉️ Email" />
          <QuickLink href="/calendar" label="📅 Calendar" />
        </div>
      </div>
    </div>
  );
}

function order(p: Task["priority"]) {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}
function pStyle(p: Task["priority"]) {
  return p === "high"
    ? "text-pink-300 border-pink-500/30"
    : p === "medium"
    ? "text-amber-300 border-amber-500/30"
    : "text-slate-400 border-slate-500/30";
}

function Panel({
  title, href, cta, children,
}: { title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white">{title}</h3>
        <Link href={href} className="text-xs text-accent hover:underline">{cta} →</Link>
      </div>
      {children}
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <p className="text-sm text-slate-500 py-4 text-center">{label}</p>;
}
function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/40 text-sm transition"
    >
      {label}
    </Link>
  );
}
