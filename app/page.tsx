"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import {
  useLocalStorage,
  type Project,
  type Note,
  type Task,
  type StoredFile,
} from "@/lib/store";

export default function Dashboard() {
  const [projects] = useLocalStorage<Project[]>("evo.projects", []);
  const [notes] = useLocalStorage<Note[]>("evo.notes", []);
  const [tasks] = useLocalStorage<Task[]>("evo.tasks", []);
  const [files] = useLocalStorage<StoredFile[]>("evo.files", []);

  const openTasks = tasks.filter((t) => !t.done).length;
  const activeProjects = projects.filter((p) => p.status === "active").length;

  const stats = [
    { label: "Projects", value: projects.length, sub: `${activeProjects} active`, href: "/projects" },
    { label: "Open Tasks", value: openTasks, sub: `${tasks.length} total`, href: "/tasks" },
    { label: "Notes", value: notes.length, sub: "saved", href: "/notes" },
    { label: "Files", value: files.length, sub: "stored", href: "/files" },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Welcome to Evolution OS"
        subtitle="Your personal AI command center."
        action={
          <Link href="/chat" className="btn-primary">
            Launch AI Chat
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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

      {/* Hero / quick actions */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass p-8 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-accent2/20 blur-3xl rounded-full" />
          <h2 className="text-xl font-semibold text-white">
            Talk to your assistant
          </h2>
          <p className="text-slate-400 mt-2 max-w-md">
            Type or speak with your voice. Evolution OS connects to OpenAI to
            answer questions, brainstorm, and help you get things done — then
            reads its answer back to you out loud.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Link href="/chat" className="btn-primary">
              Start a conversation
            </Link>
            <Link href="/settings" className="btn-ghost">
              Connect API key
            </Link>
          </div>
        </div>

        <div className="glass p-6">
          <h3 className="font-semibold text-white mb-3">Quick links</h3>
          <div className="flex flex-col gap-2 text-sm">
            <QuickLink href="/projects" label="Create a project" />
            <QuickLink href="/notes" label="Write a note" />
            <QuickLink href="/tasks" label="Add a task" />
            <QuickLink href="/files" label="Upload a file" />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/40 transition"
    >
      <span>{label}</span>
      <span className="text-accent">→</span>
    </Link>
  );
}
